import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * zustand 5 reads a selector through useSyncExternalStore, which re-renders whenever the selector
 * hands back something new. A selector that builds a fresh array or object on every read — most
 * often a `?? []` fallback while data hasn't loaded — re-renders forever and crashes the screen
 * with React error #185 ("Maximum update depth exceeded"). Desktop 0.0.12 shipped one in the first
 * chat. Default outside the selector (`useStore((s) => s.x) ?? EMPTY`) or select a primitive.
 */

const SRC = new URL(".", import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** `useStore((s) => …)` and friends: the selector body up to its closing paren, on one line. */
const SELECTOR = /\buse[A-Z]\w*\(\s*\(?\s*s\s*\)?\s*=>\s*([^;\n]*)/g;
/** A selector that returns a fresh value on every read. */
const FRESH = [
  /\?\?\s*\[\]\s*\)/, // s.list ?? []
  /\?\?\s*\{\}\s*\)/, // s.map ?? {}
  /^\(\{/, // (s) => ({ … })
  /^\[/, // (s) => [ … ]
];

function unstableSelectors(code: string): string[] {
  const hits: string[] = [];
  for (const m of code.matchAll(SELECTOR)) if (FRESH.some((re) => re.test(m[1].trim()))) hits.push(m[0].trim());
  return hits;
}

describe("store selectors", () => {
  it("flags the selector that crashed the first chat", () => {
    expect(unstableSelectors("const messages = useStore((s) => s.messages[channelId] ?? []);")).toHaveLength(1);
    expect(unstableSelectors("const o = useStore((s) => ({ a: s.a, b: s.b }));")).toHaveLength(1);
    expect(unstableSelectors("const messages = useStore((s) => s.messages[channelId]) ?? NO_MESSAGES;")).toHaveLength(0);
    expect(unstableSelectors("const orgs = useStore((s) => s.orgs) ?? [];")).toHaveLength(0);
  });

  it("no web selector returns a fresh array or object on every read", () => {
    const found = sources(SRC).flatMap((file) => unstableSelectors(readFileSync(file, "utf8")).map((hit) => `${relative(SRC, file)}: ${hit}`));
    expect(found).toEqual([]);
  });
});
