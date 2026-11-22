import { useEffect, useState, type RefObject } from "react";
import { api } from "../../api.ts";
import { firstLine } from "./logic.ts";

/** What a list row shows of a note beyond its title: its first line, and who changed it last. */
export interface Preview {
  line: string;
  by: string | null;
  at: number;
}

// one entry per note, replaced when the note changes (its updatedAt moves)
const cache = new Map<string, { version: number; preview: Preview }>();
const pending = new Map<string, Promise<Preview>>();
const queue: (() => void)[] = [];
let running = 0;

/** A few at a time, so a long list never floods the hub. */
function turn<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      running++;
      job()
        .then(resolve, reject)
        .finally(() => {
          running--;
          queue.shift()?.();
        });
    };
    if (running < 4) run();
    else queue.push(run);
  });
}

function load(path: string, version: number, title: string): Promise<Preview> {
  const key = `${path}@${version}`;
  let p = pending.get(key);
  if (!p) {
    p = turn(() => api<{ content: string; editedBy: string | null; editedAt: string | null }>("GET", `/api/vault/note?path=${encodeURIComponent(path)}`))
      .then(
        (n) => ({ line: firstLine(n.content, title), by: n.editedBy, at: n.editedAt ? Date.parse(n.editedAt) || 0 : 0 }),
        () => ({ line: "", by: null, at: 0 }),
      )
      .then((preview) => {
        cache.set(path, { version, preview });
        pending.delete(key);
        return preview;
      });
    pending.set(key, p);
  }
  return p;
}

/** A note's first line and last author, read once the row is on screen and kept until the note changes. */
export function useNotePreview(path: string, version: number, title: string, on: boolean): Preview | null {
  const have = cache.get(path);
  const [, bump] = useState(0);
  const fresh = have?.version === version;
  useEffect(() => {
    if (!on || fresh) return;
    let live = true;
    load(path, version, title).then(() => live && bump((n) => n + 1));
    return () => {
      live = false;
    };
  }, [path, version, title, on, fresh]);
  // an older line is better than a blank while the new one loads
  return have?.preview ?? null;
}

/** True once the element has scrolled into view (and from then on). */
export function useSeen(ref: RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    if (typeof IntersectionObserver === "undefined") return setSeen(true);
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen]);
  return seen;
}
