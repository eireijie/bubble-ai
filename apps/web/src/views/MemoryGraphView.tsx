import { useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ListFilter, Search, X } from "lucide-react";
import { Button, Popover, cx } from "../components/ui.tsx";
import { GRAPH_KINDS, MemoryGraph, kindColor, kindLabel, type GraphData, type GraphKind, type GraphNode } from "../components/MemoryGraph.tsx";
import { iconBtn, menuRow } from "./memory/parts.tsx";

/** "Sam, Release and Dentist": the notes most others link to, for the graph's spoken label. */
export function mostLinked(graph: GraphData, n = 3): string[] {
  return graph.nodes
    .filter((x) => x.path && x.inbound > 0)
    .sort((a, b) => b.inbound - a.inbound || b.links - a.links || a.title.localeCompare(b.title))
    .slice(0, n)
    .map((x) => x.title);
}

/** The whole memory as a map: every note you can read, and the links between them. Bigger dots are linked the most. */
export function MemoryGraphView({
  graph,
  initialKind,
  initialSelect,
  where,
  onOpen,
  onWrite,
  header,
}: {
  graph: GraphData | null;
  /** start with only this folder kind showing */
  initialKind?: GraphKind | null;
  /** open with this note picked (from "Show in graph" on a note) */
  initialSelect?: string | null;
  /** where a note lives, in words ("Shared", "@atlas", "Sam") */
  where: (path: string) => string;
  onOpen: (path: string) => void;
  /** start writing a note that's linked to but doesn't exist yet */
  onWrite?: (title: string) => void;
  /** the page's own header, given the graph's one filter button to place in it */
  header?: (filter: ReactNode) => ReactNode;
}) {
  const [hidden, setHidden] = useState<Set<GraphKind>>(() => (initialKind ? new Set(GRAPH_KINDS.filter((k) => k !== initialKind)) : new Set()));
  const [tag, setTag] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<GraphNode | null>(() => (initialSelect ? (graph?.nodes.find((n) => n.id === initialSelect) ?? null) : null));
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(() => (initialSelect ? { id: initialSelect, n: Date.now() } : null));
  const zoom = useRef<((how: "in" | "out" | "fit") => void) | null>(null);

  const counts = useMemo(() => {
    const c = new Map<GraphKind, number>();
    for (const n of graph?.nodes ?? []) c.set(n.kind, (c.get(n.kind) ?? 0) + 1);
    return c;
  }, [graph]);
  const tags = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of graph?.nodes ?? []) for (const t of n.tags) c.set(t, (c.get(t) ?? 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [graph]);

  const shown = useMemo<GraphData>(() => {
    if (!graph) return { nodes: [], edges: [] };
    const nodes = graph.nodes.filter((n) => !hidden.has(n.kind) && (!tag || n.tags.includes(tag)));
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
  }, [graph, hidden, tag]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return shown.nodes
      .filter((n) => n.title.toLowerCase().includes(q) || n.path?.toLowerCase().includes(q))
      .sort((a, b) => Number(!a.title.toLowerCase().startsWith(q)) - Number(!b.title.toLowerCase().startsWith(q)) || b.links - a.links)
      .slice(0, 6);
  }, [query, shown]);

  const pick = (n: GraphNode) => {
    setPicked(n);
    setFocus({ id: n.id, n: Date.now() });
    setQuery("");
  };
  const toggle = (k: GraphKind) => {
    const next = new Set(hidden);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setHidden(next);
  };
  const open = (n: GraphNode) => n.path && onOpen(n.path);

  const filtering = hidden.size > 0 || !!tag;
  // the one control the graph has: which folders and tags show, finding a note, and fitting everything back in view
  const filter = (
    <Popover
      up={false}
      align="right"
      className="w-64 max-h-[min(70vh,520px)] overflow-y-auto p-1.5"
      trigger={(isOpen, toggleOpen) => (
        <button onClick={toggleOpen} className={cx(iconBtn, "relative")} aria-haspopup="dialog" aria-expanded={isOpen} aria-label="Filter the graph: folders and tags" title="Filter">
          <ListFilter size={16} />
          {filtering && <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-info ring-2 ring-panel" aria-hidden />}
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="mb-1 flex h-9 max-md:h-11 items-center gap-2 rounded-lg bg-chip px-2.5">
            <Search size={14} className="shrink-0 text-muted" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches[0]) {
                  pick(matches[0]);
                  close();
                }
              }}
              placeholder="Find a note"
              aria-label="Find a note in the graph"
              className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted"
            />
          </div>
          {matches.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                pick(n);
                close();
              }}
              className={menuRow}
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: kindColor(n.kind) }} />
              <span className="min-w-0 flex-1 truncate">{n.title}</span>
              <span className="max-w-[40%] truncate text-xs text-muted">{n.path ? where(n.path) : kindLabel("ghost")}</span>
            </button>
          ))}
          {!query.trim() && (
            <>
              <div role="group" aria-label="Show folders">
                {GRAPH_KINDS.filter((k) => counts.get(k)).map((k) => {
                  const on = !hidden.has(k);
                  return (
                    <button key={k} aria-pressed={on} onClick={() => toggle(k)} className={menuRow}>
                      <span className={cx("size-2.5 shrink-0 rounded-full", k === "ghost" && "ring-1 ring-inset ring-current bg-transparent!")} style={{ background: kindColor(k), color: kindColor(k) }} />
                      <span className="min-w-0 flex-1 truncate">{kindLabel(k)}</span>
                      <span className="text-xs tabular-nums text-muted">{counts.get(k)}</span>
                      <Check size={15} className={cx("shrink-0 text-muted", !on && "invisible")} aria-hidden />
                    </button>
                  );
                })}
              </div>
              {tags.length > 0 && (
                <div role="group" aria-label="Only notes with this tag">
                  <div className="-mx-1 my-1 h-px bg-line" />
                  {tags.map(([t, c]) => (
                    <button key={t} aria-pressed={tag === t} onClick={() => setTag(tag === t ? "" : t)} className={menuRow}>
                      <span className="min-w-0 flex-1 truncate">#{t}</span>
                      <span className="text-xs tabular-nums text-muted">{c}</span>
                      <Check size={15} className={cx("shrink-0 text-muted", tag !== t && "invisible")} aria-hidden />
                    </button>
                  ))}
                </div>
              )}
              <div className="-mx-1 my-1 h-px bg-line" />
              <button
                onClick={() => {
                  zoom.current?.("fit");
                  close();
                }}
                className={cx(menuRow, "text-muted")}
              >
                Show everything
              </button>
            </>
          )}
        </div>
      )}
    </Popover>
  );

  const top = graph ? mostLinked(shown) : [];
  const linked = picked && graph ? new Set(graph.edges.flatMap((e) => (e.source === picked.id ? [e.target] : e.target === picked.id ? [e.source] : []))).size : 0;
  return (
    <div className="h-full flex flex-col min-h-0">
      {header?.(filter)}
      <div className="relative flex-1 min-h-0">
        {!graph ? null : shown.nodes.length ? (
          <MemoryGraph
            graph={shown}
            selected={picked?.id}
            focus={focus}
            zoom={zoom}
            onSelect={setPicked}
            onOpen={open}
            className="absolute inset-0"
            label={`Graph of ${shown.nodes.length} notes and ${shown.edges.length} links.${top.length ? ` ${top.length > 1 ? `${top.slice(0, -1).join(", ")} and ${top[top.length - 1]} are` : `${top[0]} is`} the most linked.` : ""}`}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-[13px] text-muted">{graph.nodes.length ? "No matches" : "No notes yet"}</div>
        )}
        {!header && <div className="absolute right-3 top-3">{filter}</div>}

        {/* the picked note */}
        {picked && (
          <div className="absolute left-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-3 md:right-auto md:w-80 rounded-[12px] glass p-3.5">
            <div className="flex items-start gap-2">
              <span className="mt-1.5 size-2.5 rounded-full shrink-0" style={{ background: kindColor(picked.kind) }} />
              <div className="flex-1 min-w-0">
                <div className="truncate text-[15px] font-semibold">{picked.title}</div>
                <div className="truncate text-xs text-muted">{[picked.path ? where(picked.path) : kindLabel("ghost"), picked.type, `${linked} ${linked === 1 ? "link" : "links"}`].filter(Boolean).join(" · ")}</div>
              </div>
              <button onClick={() => setPicked(null)} className="p-1 -m-1 text-muted hover:text-ink" aria-label="Close">
                <X size={15} />
              </button>
            </div>
            {(picked.path || onWrite) && (
              <div className="mt-2.5 flex justify-end">
                {picked.path ? (
                  <Button variant="primary" className="h-8" onClick={() => open(picked)}>
                    Open note
                  </Button>
                ) : (
                  onWrite && (
                    <Button variant="primary" className="h-8" onClick={() => onWrite(picked.title)}>
                      Write it
                    </Button>
                  )
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
