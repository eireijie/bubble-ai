import { useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import type { Agent } from "@bubble-ai/core";
import { backgroundCss, uploadBackground, usePhotoSrc, type ChatBackground } from "../chatBackground.ts";
import { useAppearance } from "../theme.ts";
import { AgentAvatar, Modal, cx } from "./ui.tsx";

/** The 18 colours the preview sheet offers, two rows of nine (board ProfileSide). */
export const SHEET_SWATCHES = ["#74d0f7", "#7aa0f8", "#a98bf5", "#bf5af2", "#de7699", "#ef8e80", "#f4a582", "#f5c27e", "#f8d97a", "#fff59a", "#eef09a", "#bfe09a", "#b5c4b1", "#a3b8bf", "#b3a7b9", "#bcb5ad", "#ffffff", "#1c1c1c"] as const;

/** Where the lighter/deeper slider starts: the middle in light mode, toward deep in dark mode (so a pick reads as a dark tone there). */
/** Spoken names for SHEET_SWATCHES, same order. */
const SWATCH_NAMES = ["Sky", "Cornflower", "Lavender", "Violet", "Rose", "Coral", "Apricot", "Honey", "Butter", "Lemon", "Lime", "Sage", "Moss", "Steel", "Heather", "Stone", "White", "Black"];

export const shadeStart = (dark: boolean) => (dark ? 80 : 50);

/**
 * A swatch moved lighter or deeper: 0 is toward white, 50 is the swatch itself, 100 is toward black
 * (never all the way: 85% at the ends, so a colour is always left).
 */
export function shadeColor(hex: string, shade: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const t = (Math.min(100, Math.max(0, shade)) - 50) / 50;
  const to = t < 0 ? 255 : 0;
  const k = Math.abs(t) * 0.85;
  return "#" + c.map((v) => Math.round(v + (to - v) * k).toString(16).padStart(2, "0")).join("");
}

type Draft = { kind: "color"; pick: string; shade: number } | { kind: "photo"; bg: ChatBackground };

/**
 * Picking a chat background the way a phone does: a sheet showing a chat over the draft, which
 * changes as you pick. Colour: 18 swatches and a lighter/deeper slider. Photo: the photo, and
 * Choose another photo… Nothing is saved until Set.
 *
 * Returns the two ways in (openColour, openPhoto: the file picker, then the sheet) and the node to
 * render. Used by an agent's profile (its own background) and by Settings (the default).
 */
export function useBackgroundSheet({ agent, name, current, onSet }: { agent?: Agent; name: string; current: ChatBackground | null; onSet: (bg: ChatBackground) => Promise<void> }) {
  const dark = useAppearance().resolvedMode === "dark";
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const openColour = () => {
    setError(null);
    // a colour picked from the sheet before starts there; anything else on the first swatch
    const was = current?.kind === "color" ? current.color.toLowerCase() : null;
    const pick = (was && SHEET_SWATCHES.find((s) => s === was)) || SHEET_SWATCHES[2];
    setDraft({ kind: "color", pick, shade: was && pick === was ? 50 : shadeStart(dark) });
  };
  const openPhoto = () => {
    setError(null);
    file.current?.click();
  };
  const chosen = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      setDraft({ kind: "photo", bg: await uploadBackground(f) });
    } catch (e) {
      setError((e as Error).message || "That photo didn't upload.");
    } finally {
      setBusy(false);
    }
  };
  const set = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await onSet(draft.kind === "color" ? { kind: "color", color: shadeColor(draft.pick, draft.shade) } : draft.bg);
      setDraft(null);
    } catch (e) {
      setError((e as Error).message || "That didn't save.");
    } finally {
      setBusy(false);
    }
  };

  const node = (
    <>
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          void chosen(f);
        }}
      />
      {draft && (
        <PreviewSheet agent={agent} name={name} draft={draft} dark={dark} busy={busy} error={error} onDraft={setDraft} onAnotherPhoto={openPhoto} onCancel={() => setDraft(null)} onSet={() => void set()} />
      )}
    </>
  );
  return { openColour, openPhoto, node, busy, error: draft ? null : error };
}

function PreviewSheet({ agent, name, draft, dark, busy, error, onDraft, onAnotherPhoto, onCancel, onSet }: { agent?: Agent; name: string; draft: Draft; dark: boolean; busy: boolean; error: string | null; onDraft: (d: Draft) => void; onAnotherPhoto: () => void; onCancel: () => void; onSet: () => void }) {
  const photo = usePhotoSrc(draft.kind === "photo" ? draft.bg : null);
  const shown = draft.kind === "color" ? shadeColor(draft.pick, draft.shade) : null;
  const css = draft.kind === "color" ? backgroundCss({ kind: "color", color: shown! }, null, dark) : backgroundCss(draft.bg, photo, dark);
  return (
    <Modal title={`${name}'s background`} label={`Preview ${name}'s background`} onClose={onCancel} headerless className="relative h-[min(640px,calc(100dvh-24px))] overflow-hidden! border-0! sm:max-w-[520px]! rounded-[24px]! shadow-[0_30px_80px_rgba(0,0,0,.3)]" contentClassName="h-full px-0! pb-0! sm:px-0! sm:pb-0!">
      <div className="chat-walled relative flex h-full flex-col transition-[background] duration-200" style={{ background: css ?? "var(--panel)", ["--bubble-them" as string]: dark ? "rgb(255 255 255 / 0.13)" : "rgb(255 255 255 / 0.82)" }} data-testid="background-preview">
        {draft.kind === "photo" && !photo && <Loader2 size={22} className="absolute left-1/2 top-1/3 -translate-x-1/2 animate-spin text-muted" aria-label="Loading the photo" />}
        <div className="flex flex-col items-center gap-1 pt-4">
          {agent ? <AgentAvatar agent={agent} size={46} /> : <span className="size-[46px] rounded-full bg-[var(--wisp)]" aria-hidden />}
          <span className="lg-glass rounded-[14px] px-3 py-0.5 text-[13.5px] font-semibold">{name}</span>
        </div>
        <div className="flex flex-1 flex-col justify-center gap-2.5 px-[18px] py-5 text-[15px] leading-[21px]" aria-hidden>
          <Bubble me>Can you move my dentist appointment?</Bubble>
          <Bubble>Sure. Tuesday 3pm or Thursday 10am?</Bubble>
          <Bubble me>Thursday</Bubble>
        </div>
        <div className="lg-glass mx-3 mb-3 rounded-[18px] p-3">
          {draft.kind === "color" ? (
            <>
              <div role="radiogroup" aria-label="Colour" className="grid grid-cols-9 justify-items-center gap-2">
                {SHEET_SWATCHES.map((hex, i) => {
                  const on = hex === draft.pick;
                  return (
                    <button
                      key={hex}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={SWATCH_NAMES[i]}
                      onClick={() => onDraft({ kind: "color", pick: hex, shade: shadeStart(dark) })}
                      className={cx("aspect-square w-full max-w-[30px] rounded-full border-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50", on ? "border-ink" : dark ? "border-white/20" : "border-black/12")}
                      style={{ background: hex }}
                    />
                  );
                })}
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={draft.shade}
                onChange={(e) => onDraft({ ...draft, shade: Number(e.target.value) })}
                aria-label="Lighter or deeper"
                className="mt-3 w-full"
                style={{ accentColor: shown! }}
              />
            </>
          ) : (
            <button type="button" onClick={onAnotherPhoto} disabled={busy} className="h-9 w-full rounded-[10px] bg-panel/85 text-[13px] hover:bg-panel disabled:opacity-60">
              Choose another photo…
            </button>
          )}
          {error && <p className="mt-2 text-[13px] text-bad">{error}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="h-[34px] rounded-full bg-ink/10 px-[18px] text-[13.5px] text-ink hover:bg-ink/15">
              Cancel
            </button>
            <button type="button" onClick={onSet} disabled={busy || (draft.kind === "photo" && !photo)} className="inline-flex h-[34px] items-center gap-1.5 rounded-full bg-ink px-[22px] text-[13.5px] font-semibold text-panel hover:opacity-90 disabled:opacity-60">
              {busy && <Loader2 size={13} className="animate-spin" />} Set
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Bubble({ me, children }: { me?: boolean; children: ReactNode }) {
  return <div className={cx("bubble max-w-[70%] rounded-[19px] px-3.5 py-2", me ? "me" : "them self-start")}>{children}</div>;
}
