/**
 * Copy and paste that also work where `navigator.clipboard` doesn't: the Android app's web view and
 * any browser on plain http (not a secure context). Order: the Android app's own bridge, the async
 * Clipboard API, then the old execCommand("copy") on a hidden text field.
 */
type Bridge = { copyText?(text: string): void; readText?(): string };
const bridge = (): Bridge | null => (typeof window !== "undefined" ? ((window as unknown as { WispAndroid?: Bridge }).WispAndroid ?? null) : null);

/** Put `text` on this device's clipboard. Resolves when it is there; rejects when nothing worked. */
export async function copyText(text: string): Promise<void> {
  const b = bridge();
  if (typeof b?.copyText === "function") {
    b.copyText(text);
    return;
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* not allowed here: try the old way */
    }
  }
  if (!copyWithExecCommand(text)) throw new Error("Couldn't copy. Select the text and copy it instead.");
}

function copyWithExecCommand(text: string): boolean {
  if (typeof document === "undefined") return false;
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
  const active = document.activeElement as HTMLElement | null;
  document.body.appendChild(field);
  field.select();
  field.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  field.remove();
  active?.focus?.({ preventScroll: true });
  return ok;
}

/** Whether `readText` can work here. */
export const canReadClipboard = (): boolean =>
  typeof bridge()?.readText === "function" || (typeof navigator !== "undefined" && !!navigator.clipboard?.readText && typeof window !== "undefined" && window.isSecureContext);

/** The text on this device's clipboard, or null when it can't be read. */
export async function readText(): Promise<string | null> {
  const b = bridge();
  if (typeof b?.readText === "function") {
    try {
      return b.readText();
    } catch {
      return null;
    }
  }
  try {
    return (await navigator.clipboard?.readText()) ?? null;
  } catch {
    return null;
  }
}
