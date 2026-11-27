import { z } from "zod";
import type { ChatBackground } from "@bubble-ai/core";
import type { Store } from "./store.ts";

/** Photos a chat background may be: the image types the browser shows inline (api.ts INLINE_FILE). */
const BACKGROUND_IMAGE = /^image\/(png|jpeg|gif|webp|avif|bmp)$/;

/** A chat background as the web app sends it (AgentSettings.background, UserPrefs.background). */
export const CHAT_BACKGROUND = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("color"), color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a #rrggbb color") }).strict(),
  // only a hub file: no outside addresses, so a background never loads anything from elsewhere
  z.object({ kind: z.literal("photo"), url: z.string().regex(/^\/api\/files\/[A-Za-z0-9_-]{1,64}$/, "must be an uploaded file (/api/files/<id>)") }).strict(),
]);

/**
 * Why this background can't be saved in this organization, or null when it can. A photo must be an
 * image uploaded to the same organization and not tied to one chat (a chat's files are only for
 * the people in it; a background is shown to everyone who opens the agent's chat).
 */
export function backgroundProblem(store: Store, workspaceId: string, bg: ChatBackground): string | null {
  if (bg.kind !== "photo") return null;
  const f = store.file(bg.url.slice("/api/files/".length));
  if (!f || f.workspaceId !== workspaceId) return "background: that photo isn't uploaded here";
  if (f.channelId) return "background: upload the photo on its own, not into a chat";
  if (!BACKGROUND_IMAGE.test(f.mime)) return "background: pick a photo (PNG, JPEG, GIF, WebP, AVIF or BMP)";
  return null;
}
