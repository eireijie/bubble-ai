/** "/que" (or "@poopy /que") from the start of the message up to the caret, or null when the menu shouldn't show. */
export function slashQuery(beforeCaret: string): { handle: string | null; query: string } | null {
  const m = /^\s*(?:@([\w-]+)\s+)?\/([\w:.-]*)$/.exec(beforeCaret);
  return m ? { handle: m[1]?.toLowerCase() ?? null, query: m[2].toLowerCase() } : null;
}

/** Commands whose hint is only an option ("/compact what to keep"), so typing just the name is complete. */
const OPTIONAL_ARG = new Set(["compact"]);

/**
 * What Enter does on the highlighted command: "send" when the text typed is exactly that command
 * and it needs no argument (/new, /stop, /context, /compact), else "pick" (fill "/name " and wait).
 */
export function slashEnterAction(typed: string, command: { name: string; hint?: string }): "send" | "pick" {
  const q = slashQuery(typed);
  const name = command.name.toLowerCase();
  if (!q || q.query !== name) return "pick";
  return !command.hint || OPTIONAL_ARG.has(name) ? "send" : "pick";
}
