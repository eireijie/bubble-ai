import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Render loops the one-line scan in storeSelectors.test.ts cannot see. Each rule reads the code as
 * a syntax tree, so it follows selectors over several lines, selectors passed by name, and the
 * hooks around them. All of these end in React error #185 ("Maximum update depth exceeded") or in
 * a screen that never stops rendering:
 *
 *  1. a store selector that returns something new on every read (a `.filter()`, a `[...]`, a `{}`,
 *     a `?? []`), written inline, over several lines, or as a named function;
 *  2. `useSyncExternalStore` whose snapshot is new on every read, or whose subscribe function is
 *     made anew on every render (React then unsubscribes and subscribes again each time);
 *  3. an effect with no dependency list that sets state as it runs;
 *  4. state set while rendering with nothing guarding it;
 *  5. an effect that sets state and depends on a value that is new on every render (a list built
 *     in the component, a prop that defaults to `[]`);
 *  6. a ref callback written in place (`ref={(el) => …}`, called again on every render) that sets
 *     state with nothing guarding it.
 *
 * To fix one: pick a primitive or a stored value in the selector and derive outside it (or wrap
 * the selector in `useShallow`), keep fallbacks in a constant (`const NONE: T[] = []`), memoise
 * what an effect depends on, and compare before setting state in render.
 *
 * The rules go by the shape of the code, not its types, so `.slice()` or `.concat()` on a string
 * inside a selector is flagged like one on a list: select the string and cut it outside.
 */

const SRC = new URL(".", import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Methods that hand back a new array, object or iterator each call. */
const FRESH_CALLS = new Set(["filter", "map", "slice", "sort", "concat", "flat", "flatMap", "toSorted", "toReversed", "toSpliced", "reverse", "splice", "split", "values", "keys", "entries", "from", "of", "fromEntries", "assign"]);

function unwrap(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e)) e = e.expression;
  return e;
}

/** Why this expression is a new value every time it runs, or null when it may be a stable one. */
function fresh(expr: ts.Expression | undefined): string | null {
  if (!expr) return null;
  const e = unwrap(expr);
  if (ts.isArrayLiteralExpression(e)) return "a new array";
  if (ts.isObjectLiteralExpression(e)) return "a new object";
  if (ts.isNewExpression(e)) return "a new instance";
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return "a new function";
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && ts.isIdentifier(e.expression.expression) && e.expression.expression.text === "JSON" && e.expression.name.text === "parse") return "a newly parsed value";
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && FRESH_CALLS.has(e.expression.name.text)) return `a new value from .${e.expression.name.text}()`;
  if (ts.isBinaryExpression(e) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(e.operatorToken.kind)) return fresh(e.right) ?? fresh(e.left);
  if (ts.isConditionalExpression(e)) return fresh(e.whenTrue) ?? fresh(e.whenFalse);
  return null;
}

type Fn = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;
const isFn = (n: ts.Node | undefined): n is Fn => !!n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n));

/** Everything a function can return (not what the functions inside it return). */
function returned(fn: Fn): ts.Expression[] {
  if (!fn.body) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const out: ts.Expression[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isFunctionLike(n)) return;
    if (ts.isReturnStatement(n) && n.expression) out.push(n.expression);
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(fn.body, visit);
  return out;
}

const EFFECT = /^(React\.)?use(Effect|LayoutEffect|InsertionEffect)$/;
const LATER = new Set(["then", "catch", "finally"]);

/** The loops in one file, as "line: what is wrong". `stores` are the names of the zustand hooks. */
function renderLoops(code: string, stores: ReadonlySet<string>, file = "file.tsx"): string[] {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: string[] = [];
  const say = (n: ts.Node, what: string) => hits.push(`${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: ${what}: ${n.getText().replace(/\s+/g, " ").slice(0, 110)}`);

  /** `useStore`, `React.useEffect`; "" for anything longer (a chain of calls is never a hook). */
  const nameOf = (e: ts.Expression): string => (ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) ? `${e.expression.text}.${e.name.text}` : "");

  // functions by name, for a selector or a snapshot passed by reference
  const named = new Map<string, Fn>();
  const collect = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name) named.set(n.name.text, n);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && isFn(n.initializer)) named.set(n.name.text, n.initializer);
    ts.forEachChild(n, collect);
  };
  collect(sf);
  const asFn = (arg: ts.Expression | undefined): Fn | null => (!arg ? null : isFn(arg) ? arg : ts.isIdentifier(arg) ? (named.get(arg.text) ?? null) : null);

  const enclosing = (n: ts.Node): ts.SignatureDeclaration | null => {
    let p = n.parent;
    while (p && !ts.isFunctionLike(p)) p = p.parent;
    return (p as ts.SignatureDeclaration | undefined) ?? null;
  };
  /** The setters `const [x, setX] = useState()` (or useReducer) declares directly in a function. */
  const settersOf = new Map<ts.Node, Set<string>>();
  const setters = (fn: ts.Node): Set<string> => {
    const known = settersOf.get(fn);
    if (known) return known;
    const out = new Set<string>();
    const look = (n: ts.Node) => {
      if (ts.isFunctionLike(n)) return;
      if (ts.isVariableDeclaration(n) && ts.isArrayBindingPattern(n.name) && n.initializer && ts.isCallExpression(n.initializer) && /^(React\.)?use(State|Reducer)$/.test(nameOf(n.initializer.expression))) {
        const second = n.name.elements[1];
        if (second && ts.isBindingElement(second) && ts.isIdentifier(second.name)) out.add(second.name.text);
      }
      ts.forEachChild(n, look);
    };
    ts.forEachChild(fn, look);
    settersOf.set(fn, out);
    return out;
  };
  /** A function that runs as part of the code around it: called on the spot, or handed to .then/.catch/.finally. */
  const runsWithParent = (f: ts.Node): boolean => {
    let up = f;
    while (ts.isParenthesizedExpression(up.parent)) up = up.parent;
    const call = up.parent;
    if (!ts.isCallExpression(call)) return false;
    if (call.expression === up) return true;
    return ts.isPropertyAccessExpression(call.expression) && LATER.has(call.expression.name.text) && call.arguments.some((a) => a === up);
  };
  /**
   * Does this effect set state as it runs, or when something it started comes back (.then)? State
   * set from an event handler it registers does not count: that waits for an event.
   */
  const setsState = (effect: Fn, known: Set<string>, later = true): boolean => {
    let found = false;
    const look = (n: ts.Node) => {
      if (found) return;
      if (ts.isFunctionLike(n) && n !== effect && !(later && runsWithParent(n))) return;
      if (ts.isCallExpression(n)) {
        if ((ts.isIdentifier(n.expression) && known.has(n.expression.text)) || (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "setState")) return void (found = true);
        if (later && ts.isPropertyAccessExpression(n.expression) && LATER.has(n.expression.name.text) && n.arguments.some((a) => ts.isIdentifier(a) && known.has(a.text))) return void (found = true);
      }
      ts.forEachChild(n, look);
    };
    look(effect);
    return found;
  };
  /** Where a name used in a component comes from, when that makes it new on every render. */
  const freshInComponent = (name: string, component: ts.SignatureDeclaration): string | null => {
    for (const p of component.parameters) {
      if (ts.isIdentifier(p.name) && p.name.text === name && fresh(p.initializer)) return `the parameter defaults to ${fresh(p.initializer)}`;
      if (ts.isObjectBindingPattern(p.name)) for (const el of p.name.elements) if (ts.isIdentifier(el.name) && el.name.text === name && fresh(el.initializer)) return `the prop defaults to ${fresh(el.initializer)}`;
    }
    let why: string | null = null;
    const visit = (n: ts.Node) => {
      if (why || ts.isFunctionLike(n)) return;
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) why = fresh(n.initializer);
      ts.forEachChild(n, visit);
    };
    const body = (component as ts.FunctionLikeDeclaration).body;
    if (body) ts.forEachChild(body, visit);
    return why;
  };

  /** Is this call under an `if`, a `?:` or an `&&` / `||` inside `fn`? (Whether the check converges is for the reader.) */
  const guarded = (call: ts.Node, fn: ts.Node): boolean => {
    for (let p: ts.Node = call.parent; p && p !== fn; p = p.parent) {
      if (ts.isIfStatement(p) || ts.isConditionalExpression(p) || (ts.isBinaryExpression(p) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(p.operatorToken.kind))) return true;
    }
    return false;
  };

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = nameOf(n.expression);

      // 1. store selectors
      if (stores.has(callee)) {
        const arg = n.arguments[0];
        const shallow = !!arg && ts.isCallExpression(arg) && /(^|\.)useShallow$/.test(nameOf(arg.expression));
        const sel = shallow ? null : asFn(arg);
        if (sel) for (const r of returned(sel)) {
          const why = fresh(r);
          if (why) say(n, `selector returns ${why} on every read`);
        }
      }

      // 2. useSyncExternalStore
      if (/^(React\.)?useSyncExternalStore$/.test(callee)) {
        const [subscribe, ...snapshots] = n.arguments;
        // written in place, or a function declared inside the component: either way a new one each render
        const local = subscribe && ts.isIdentifier(subscribe) ? named.get(subscribe.text) : undefined;
        if (subscribe && (isFn(subscribe) || (local && enclosing(local)))) say(n, "subscribe is a new function on every render");
        for (const snapshot of snapshots) {
          const fn = asFn(snapshot);
          if (fn) for (const r of returned(fn)) {
            const why = fresh(r);
            if (why) say(n, `snapshot returns ${why} on every read`);
          }
        }
      }

      // 3 and 5. effects
      if (EFFECT.test(callee) && isFn(n.arguments[0])) {
        const effect = n.arguments[0];
        const component = enclosing(n);
        const known = component ? setters(component) : new Set<string>();
        const deps = n.arguments[1];
        if (!deps) {
          // only what runs with the effect itself counts here: a later callback is not a render loop
          if (setsState(effect, known, false)) say(n, "effect with no dependency list sets state every time it runs");
        } else if (ts.isArrayLiteralExpression(deps) && component && setsState(effect, known)) {
          for (const d of deps.elements) {
            const why = fresh(d) ?? (ts.isIdentifier(d) ? freshInComponent(d.text, component) : null);
            if (why) say(n, `effect sets state and depends on \`${d.getText().replace(/\s+/g, " ").slice(0, 40)}\`, which is new on every render (${why})`);
          }
        }
      }

      // 4. state set while rendering
      const fn = enclosing(n);
      if (fn && ts.isIdentifier(n.expression) && setters(fn).has(n.expression.text) && !guarded(n, fn)) say(n, "state set on every render");
    }

    // 6. a ref callback written in place is called again on every render
    if (ts.isJsxAttribute(n) && n.name.getText() === "ref" && n.initializer && ts.isJsxExpression(n.initializer) && isFn(n.initializer.expression)) {
      const ref = n.initializer.expression;
      const component = enclosing(n);
      const known = component ? setters(component) : new Set<string>();
      const look = (m: ts.Node) => {
        if (ts.isFunctionLike(m) && m !== ref) return;
        if (ts.isCallExpression(m) && ts.isIdentifier(m.expression) && known.has(m.expression.text) && !guarded(m, ref)) say(m, "ref callback sets state on every render");
        ts.forEachChild(m, look);
      };
      look(ref);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

/** The zustand hooks: `export const useStore = create<State>(…)`. */
function storeHooks(files: string[]): Set<string> {
  const names = new Set<string>();
  for (const file of files) for (const m of readFileSync(file, "utf8").matchAll(/\bconst\s+(use[A-Z]\w*)\s*=\s*create\b/g)) names.add(m[1]);
  return names;
}

const STORES = new Set(["useStore"]);
const found = (code: string) => renderLoops(code, STORES);

describe("render loops", () => {
  it("flags selectors the one-line scan misses", () => {
    // over several lines
    expect(found("const a = useStore((s) => {\n  const list = s.messages[id];\n  return list ?? [];\n});")).toHaveLength(1);
    // derived inside the selector
    expect(found("const busy = useStore((s) => s.agents.filter((a) => a.status === 'busy'));")).toHaveLength(1);
    expect(found("const ids = useStore((s) => Object.keys(s.live));")).toHaveLength(1);
    expect(found("const both = useStore((s) => (ready ? [s.a, s.b] : null));")).toHaveLength(1);
    // passed by name
    expect(found("const pick = (s: State) => ({ a: s.a });\nconst v = useStore(pick);")).toHaveLength(1);
    expect(found("function pick(s: State) { return s.list.map((x) => x.id); }\nconst v = useStore(pick);")).toHaveLength(1);
    // fine: a primitive, a stored value, a default outside, a shallow compare
    expect(found("const key = useStore((s) => s.agents.map((a) => a.id).join(','));")).toEqual([]);
    expect(found("const agent = useStore((s) => s.agents.find((a) => a.id === id));")).toEqual([]);
    expect(found("const list = useStore((s) => s.messages[id]) ?? NONE;")).toEqual([]);
    expect(found("const o = useStore(useShallow((s) => ({ a: s.a, b: s.b })));")).toEqual([]);
  });

  it("flags useSyncExternalStore with a new snapshot or a new subscribe function", () => {
    expect(found("const v = useSyncExternalStore(subscribe, () => ({ ...state }));")).toHaveLength(1);
    expect(found("const read = () => JSON.parse(localStorage.getItem('k') ?? '[]');\nconst v = useSyncExternalStore(subscribe, read, read);")).toHaveLength(2);
    expect(found("const v = useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)), get);")).toHaveLength(1);
    expect(found("function useThing() {\n  const subscribe = (cb: () => void) => on(cb);\n  return useSyncExternalStore(subscribe, get);\n}")).toHaveLength(1);
    expect(found("const subscribe = (cb: () => void) => on(cb);\nfunction useThing() {\n  return useSyncExternalStore(subscribe, get);\n}")).toEqual([]);
    expect(found("const v = useSyncExternalStore(subscribe, () => currentHash);")).toEqual([]);
    expect(found("const v = useSyncExternalStore(on ? subscribe : none, on ? get : idle, idle);")).toEqual([]);
  });

  it("flags an effect with no dependency list that sets state", () => {
    expect(found("function A() {\n  const [n, setN] = useState(0);\n  useEffect(() => { setN(n + 1); });\n}")).toHaveLength(1);
    // a listener it registers may set state: that waits for an event
    expect(found("function A() {\n  const [n, setN] = useState(0);\n  useEffect(() => { const on = () => setN(1); window.addEventListener('x', on); return () => window.removeEventListener('x', on); });\n}")).toEqual([]);
    expect(found("function A() {\n  const [n, setN] = useState(0);\n  useEffect(() => { setN(1); }, []);\n}")).toEqual([]);
  });

  it("flags state set on every render", () => {
    expect(found("function A({ v }) {\n  const [last, setLast] = useState(v);\n  setLast(v);\n  return null;\n}")).toHaveLength(1);
    expect(found("function A({ v }) {\n  const [last, setLast] = useState(v);\n  if (last !== v) setLast(v);\n  return null;\n}")).toEqual([]);
    expect(found("function A() {\n  const [open, setOpen] = useState(false);\n  const toggle = () => setOpen((o) => !o);\n  return null;\n}")).toEqual([]);
  });

  it("flags a ref callback that sets state each time it is called", () => {
    expect(found("function A() {\n  const [box, setBox] = useState(null);\n  return <div ref={(el) => setBox(el?.getBoundingClientRect())} />;\n}")).toHaveLength(1);
    expect(found("function A({ src }) {\n  const [loaded, setLoaded] = useState(null);\n  return <img ref={(el) => { if (el?.complete) setLoaded(src); }} />;\n}")).toEqual([]);
    expect(found("function A() {\n  const [slot, setSlot] = useState(null);\n  return <div ref={setSlot} />;\n}")).toEqual([]);
  });

  it("flags an effect that sets state and depends on a value made anew each render", () => {
    expect(found("function A({ items = [] }) {\n  const [n, setN] = useState(0);\n  useEffect(() => { setN(items.length); }, [items]);\n}")).toHaveLength(1);
    expect(found("function A({ all }) {\n  const [n, setN] = useState(0);\n  const mine = all.filter((x) => x.mine);\n  useEffect(() => { setN(mine.length); }, [mine]);\n}")).toHaveLength(1);
    expect(found("function A({ id }) {\n  const [rows, setRows] = useState(null);\n  const query = { id };\n  useEffect(() => { load(query).then((r) => setRows(r)); }, [query]);\n}")).toHaveLength(1);
    expect(found("function A({ id }) {\n  const [rows, setRows] = useState(null);\n  useEffect(() => { load(id).then(setRows); }, [[id]]);\n}")).toHaveLength(1);
    // fine: memoised, a primitive, or state set only from a handler the effect registers
    expect(found("function A({ all }) {\n  const [n, setN] = useState(0);\n  const mine = useMemo(() => all.filter((x) => x.mine), [all]);\n  useEffect(() => { setN(mine.length); }, [mine]);\n}")).toEqual([]);
    expect(found("function A({ all }) {\n  const [n, setN] = useState(0);\n  const ids = all.map((x) => x.id);\n  useEffect(() => { const k = () => setN(ids.length); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [ids]);\n}")).toEqual([]);
  });

  it("the web app has none of them", { timeout: 120_000 }, () => {
    const files = sources(SRC);
    const stores = storeHooks(files);
    expect([...stores]).toContain("useStore");
    const all = files.flatMap((file) => renderLoops(readFileSync(file, "utf8"), stores, file).map((hit) => `${relative(SRC, file)}:${hit}`));
    expect(all).toEqual([]);
  });
});
