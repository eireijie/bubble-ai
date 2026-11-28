import { useEffect, useState, type CSSProperties } from "react";
import type { GhostAppearance } from "@bubble-ai/core/src/appearance.ts";
import { fileUrl, uploadFile } from "../api.ts";

/**
 * An agent's face as a photo (round 11, board 12; the same field the iPhone writes, PR 168): a hub
 * file shown in a circle instead of the bubble. Only "/api/files/<id>" counts; anything else shows the bubble.
 */
export function lookPhotoId(photo: string | null | undefined): string | null {
  const m = typeof photo === "string" ? /^\/api\/files\/([A-Za-z0-9_-]{1,64})$/.exec(photo) : null;
  return m ? m[1] : null;
}

// hub files need the sign-in header, so each face becomes an object URL, loaded once per file
// (once loaded it shows at once, with no blank frame, wherever else it appears)
const loaded = new Map<string, Promise<string>>();
const ready = new Map<string, string>();
function useFaceSrc(id: string): string | null {
  const [src, setSrc] = useState<string | null>(() => ready.get(id) ?? null);
  useEffect(() => {
    setSrc(ready.get(id) ?? null);
    let live = true;
    let p = loaded.get(id);
    if (!p) {
      p = fileUrl(id);
      loaded.set(id, p);
      p.then((s) => void ready.set(id, s), () => loaded.delete(id));
    }
    p.then((s) => live && setSrc(s)).catch(() => {});
    return () => {
      live = false;
    };
  }, [id]);
  return src;
}

export function LookPhoto({ id, size, dim = false, label, className, style }: { id: string; size: number; dim?: boolean; label?: string; className?: string; style?: CSSProperties }) {
  const src = useFaceSrc(id);
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      data-look-photo=""
      className={className}
      style={{
        display: "inline-block",
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: "9999px",
        overflow: "hidden",
        background: "color-mix(in srgb, var(--faint) 25%, transparent)",
        boxShadow: `inset 0 0 0 ${size >= 40 ? 1 : 0.5}px var(--line2, rgb(0 0 0 / 0.1))`,
        filter: dim ? "saturate(0)" : undefined,
        opacity: dim ? 0.7 : undefined,
        ...style,
      }}
    >
      {src && <img src={src} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
    </span>
  );
}

/**
 * The look to save: what was picked laid over what's saved, so fields this editor doesn't know about
 * (a photo from the iPhone, anything newer) are kept. A field picked as `undefined` is removed.
 */
export function mergeLook(saved: GhostAppearance | undefined, picked: GhostAppearance): GhostAppearance {
  const out: Record<string, unknown> = { ...(saved ?? {}), ...picked };
  for (const [k, v] of Object.entries(picked)) if (v === undefined) delete out[k];
  return out as unknown as GhostAppearance;
}

/** The longest side a face photo is uploaded at (the iPhone uses the same). */
export const FACE_MAX = 512;

/** A picked image as a centred square JPEG, at most 512px across, so a face is small to upload and load. */
export async function squareFace(file: File): Promise<File> {
  if (!/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(file.type)) throw new Error("Pick a photo (PNG, JPEG, GIF, WebP).");
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  if (!side) throw new Error("That photo couldn't be read.");
  const out = Math.min(FACE_MAX, side);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("That photo couldn't be read.");
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  if (!blob) throw new Error("That photo couldn't be read.");
  return new File([blob], "face.jpg", { type: "image/jpeg" });
}

/** Squares and uploads a face photo through the usual file upload; gives back the look's `photo` value. */
export async function uploadFace(file: File): Promise<string> {
  const up = await uploadFile(await squareFace(file));
  return `/api/files/${up.id}`;
}
