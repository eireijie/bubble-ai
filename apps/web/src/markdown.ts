import { Marked } from "marked";
import DOMPurify from "dompurify";

const marked = new Marked({ gfm: true, breaks: true });

const pageOrigin = () => (typeof location !== "undefined" && location.origin && location.origin !== "null" ? location.origin : "http://localhost");

/** True for an image address that would make the browser contact another host. */
export function isRemoteImage(src: string): boolean {
  const s = src.trim();
  if (/^(data|blob):/i.test(s)) return false;
  try {
    const u = new URL(s, pageOrigin());
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return u.origin !== pageOrigin();
  } catch {
    return true;
  }
}

// Remote images would let any message make the viewer's browser fetch a tracking URL; show a link instead.
let hooked = false;
function hookImages() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName !== "IMG") return;
    const src = node.getAttribute("src") ?? "";
    const srcset = node.getAttribute("srcset");
    if (!isRemoteImage(src) && !(srcset && /\bhttps?:|\/\//i.test(srcset))) return;
    let host = "";
    try { host = new URL(src, pageOrigin()).host; } catch { /* keep empty */ }
    const alt = (node.getAttribute("alt") ?? "").trim();
    const a = node.ownerDocument.createElement("a");
    a.setAttribute("href", src);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
    a.setAttribute("class", "remote-image");
    a.textContent = `Image: ${alt || host || "link"}`;
    node.replaceWith(a);
  });
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function remoteImageLink(src: string, alt: string): string {
  let host = "";
  try { host = new URL(src, pageOrigin()).host; } catch { /* keep empty */ }
  return `<a class="remote-image" href="${escape(src)}" target="_blank" rel="noopener noreferrer">Image: ${escape(alt.trim() || host || "link")}</a>`;
}

marked.use({
  renderer: {
    image({ href, text }) {
      return isRemoteImage(href) ? remoteImageLink(href, text) : false;
    },
  },
});

// lucide "bot" icon, inlined so mention chips need no extra requests
const BOT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/></svg>';

/**
 * Markdown -> sanitized HTML, with Obsidian [[wikilinks]], @mentions and #tags.
 * `known` decides whether a wikilink target exists (rendered differently if missing).
 * `handles` maps agent handles to display names; mentions of them become chips, tinted with the
 * agent's own color when `colors` has one.
 */
export function renderMarkdown(src: string, opts: { known?: (target: string) => boolean; handles?: Set<string> | Map<string, string>; colors?: Map<string, string>; stripFrontmatter?: boolean } = {}): string {
  let text = src;
  if (opts.stripFrontmatter) text = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");

  // Protect code before rewriting links and mentions.
  const stash: string[] = [];
  text = text.replace(/```[\s\S]*?```|`[^`\n]*`/g, (m) => `\u0000${stash.push(m) - 1}\u0000`);

  text = text.replace(/(!?)\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, _embed, target: string, _h, alias?: string) => {
    const t = target.trim();
    const cls = opts.known && !opts.known(t) ? "wikilink missing" : "wikilink";
    return `<a class="${cls}" data-wikilink="${escape(t)}">${escape(alias?.trim() || t)}</a>`;
  });
  if (opts.handles) {
    const names = opts.handles;
    text = text.replace(/(^|[^\w@.`])@([a-zA-Z][\w-]{0,31})/g, (m, pre: string, h: string) => {
      const key = h.toLowerCase();
      if (!names.has(key)) return m;
      const label = names instanceof Map ? names.get(key)! : `@${h}`;
      const color = opts.colors?.get(key);
      const tint = color && /^#[0-9a-fA-F]{6}$/.test(color) ? ` agent" style="--agent:${color}` : "";
      return `${pre}<span class="mention${tint}" title="@${escape(key)}">${BOT_ICON}${escape(label)}</span>`;
    });
  }
  text = text.replace(/(^|\s)#([a-zA-Z][\w/-]*)/g, (_m, pre: string, tag: string) => `${pre}<span class="tag">#${escape(tag)}</span>`);
  text = text.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => stash[Number(i)]);

  hookImages();
  const html = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ["data-wikilink", "target"], ADD_TAGS: ["svg", "path", "rect"] });
}
