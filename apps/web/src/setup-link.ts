/** The link the desktop app and installer open on a new Wisp: #/setup/<setup code>. */
export const setupCodeFromHash = (hash: string) => hash.match(/^#\/setup\/([\w-]+)/)?.[1] ?? "";
