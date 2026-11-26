/**
 * Large link cards under a message (2026-11-25, Messages-style): media on top, then a title and the
 * domain. The hub keeps no link-preview data and Bubble AI fetches nothing for this, so the card is built
 * from the link itself: a picture link shows the picture, anything else a plain title and domain.
 * GitHub pull requests and issues keep their own small card, so they're left out here.
 */
export interface LinkPreview {
  url: string;
  domain: string;
  title: string;
  /** the link is a picture: shown on top of the card */
  image?: string;
}

const IMAGE = /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i;
const GITHUB_ITEM = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(pull|issues)\/\d+/;

/** A readable title from the link: the last part of its path, words split out, or the site's name. */
export function titleFromUrl(u: URL): string {
  const parts = u.pathname.split("/").filter(Boolean);
  const last = parts.length ? decodeURIComponent(parts[parts.length - 1]).replace(/\.[a-z0-9]{2,5}$/i, "") : "";
  const words = last.replace(/[-_+]+/g, " ").replace(/\s+/g, " ").trim();
  if (words && !/^\d+$/.test(words) && words.length > 2) return words.charAt(0).toUpperCase() + words.slice(1);
  const host = u.hostname.replace(/^www\./, "");
  return host.charAt(0).toUpperCase() + host.slice(1);
}

/** The first two http(s) links in a message, as cards. */
export function linkPreviews(body: string | undefined): LinkPreview[] {
  if (!body) return [];
  const out: LinkPreview[] = [];
  for (const m of body.matchAll(/https?:\/\/[^\s<>()"'`\]]+/g)) {
    const raw = m[0].replace(/[.,;:!?]+$/, "");
    if (GITHUB_ITEM.test(raw) || out.some((p) => p.url === raw)) continue;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    // links into Bubble AI itself and to this machine aren't worth a card
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hash.startsWith("#/")) continue;
    out.push({ url: raw, domain: u.hostname.replace(/^www\./, ""), title: titleFromUrl(u), ...(IMAGE.test(u.pathname) ? { image: raw } : {}) });
    if (out.length === 2) break;
  }
  return out;
}
