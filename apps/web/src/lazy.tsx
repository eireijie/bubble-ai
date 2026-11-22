import { use, type ComponentType } from "react";

/**
 * Pages and dialogs that aren't on screen at start come as their own files, so the app's first
 * file is small and the rest arrives without anyone waiting for it:
 *  - `lazyView` gives a component that fetches its file the first time it's shown (inside a
 *    <Suspense>), or earlier when something calls `preload()`;
 *  - `preloadViews` fetches every one of them, a few at a time, once the app is up and idle.
 * So moving between pages renders at once, exactly as when it was all one file. Only a page
 * opened in the first moments (before its file is in) waits, behind the Suspense fallback.
 */
export type LazyView<P> = ComponentType<P> & { preload(): Promise<void> };

const all: (() => Promise<void>)[] = [];

export function lazyView<P extends object>(load: () => Promise<ComponentType<P>>): LazyView<P> {
  let Loaded: ComponentType<P> | null = null;
  let loading: Promise<ComponentType<P>> | null = null;
  const start = () =>
    (loading ??= load().then(
      (C) => (Loaded = C),
      (e) => {
        // a file that didn't arrive (offline, or the hub was updated under this tab) can be asked for again
        loading = null;
        throw e;
      },
    ));
  function View(props: P) {
    const C = Loaded ?? use(start());
    return <C {...props} />;
  }
  const preload = () => start().then(() => {}, () => {});
  all.push(preload);
  return Object.assign(View, { preload });
}

let preloaded = false;
/**
 * Fetch every lazy view in the background: starting once the browser has a quiet moment, then a
 * few files at a time so they never crowd out what the person is doing.
 */
export function preloadViews() {
  if (preloaded) return;
  preloaded = true;
  let i = 0;
  const next = () => {
    const load = all[i++];
    if (load) void load().then(() => setTimeout(next, 0));
  };
  const start = () => {
    for (let n = 0; n < 3; n++) next();
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(start, { timeout: 1500 });
  else setTimeout(start, 300);
}
