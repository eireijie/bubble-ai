import { useRef, useState } from "react";
import { Check, ImagePlus } from "lucide-react";
import { Modal, cx } from "./ui.tsx";
import { WALLS, setWall, shrinkImage, useChatWall, wallCss, type ChatWall } from "../chatWallpaper.ts";

const same = (a: ChatWall, b: ChatWall) => (a.kind === "image" ? b.kind === "image" && a.url === b.url : b.kind === "built" && a.id === b.id);

/** Pick this chat's background: the built-in ones, Plain, or a picture of your own. Opened from the chat's ⋯. */
export function ChatWallpaperPicker({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const current = useChatWall(channelId);
  const dark = document.documentElement.dataset.mode === "dark";
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = (w: ChatWall) => {
    setError(null);
    try {
      setWall(channelId, w);
    } catch {
      setError("That picture is too big to keep on this device. Try a smaller one.");
    }
  };
  const tile = "relative grid aspect-[3/4] w-full place-items-center overflow-hidden rounded-[12px] outline-none ring-offset-2 ring-offset-panel focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <Modal title="Background" onClose={onClose} label="Chat background">
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {WALLS.map((w) => {
          const on = same(current, { kind: "built", id: w.id });
          return (
            <button key={w.id} type="button" onClick={() => pick({ kind: "built", id: w.id })} aria-pressed={on} className="flex flex-col items-center gap-1.5 text-[13px]">
              <span className={cx(tile, on ? "ring-2 ring-wisp" : "shadow-[inset_0_0_0_1px_var(--line)]")} style={{ background: dark ? w.dark : w.light }}>
                {on && <Check size={18} strokeWidth={2.4} className="text-ink" />}
              </span>
              <span className={on ? "font-medium text-ink" : "text-muted"}>{w.name}</span>
            </button>
          );
        })}
        <button type="button" disabled={busy} onClick={() => file.current?.click()} aria-pressed={current.kind === "image"} className="flex flex-col items-center gap-1.5 text-[13px]">
          <span className={cx(tile, "bg-chip text-muted", current.kind === "image" && "ring-2 ring-wisp")} style={current.kind === "image" ? { background: wallCss(current, dark) } : undefined}>
            {current.kind === "image" ? <Check size={18} strokeWidth={2.4} className="text-white drop-shadow" /> : <ImagePlus size={20} strokeWidth={1.8} />}
          </span>
          <span className={current.kind === "image" ? "font-medium text-ink" : "text-muted"}>{current.kind === "image" ? "Your picture" : "Add a picture"}</span>
        </button>
      </div>
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          try {
            pick({ kind: "image", url: await shrinkImage(f) });
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      {error && <p className="mt-3 text-[13px] text-bad">{error}</p>}
      <p className="mt-3 text-[13px] text-muted">Only this chat, on this device.</p>
    </Modal>
  );
}
