import { useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cx } from "./ui.tsx";
import { Seg } from "../views/settings/rows.tsx";
import { BACKGROUND_COLORS, uploadBackground, usePhotoSrc, type ChatBackground } from "../chatBackground.ts";

type Kind = ChatBackground["kind"];

/**
 * None · Photo · Colour, small enough for a settings row. Photo opens the file picker (again to
 * swap it); Colour shows the swatches under the row. Used by Settings for the default and by an
 * agent's profile for its own (chatBackground.ts keeps them).
 */
export function BackgroundPicker({ value, onChange, label = "Background" }: { value: ChatBackground; onChange: (bg: ChatBackground) => void; label?: string }) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const src = usePhotoSrc(value);
  const pick = (k: Kind) => {
    setError(null);
    if (k === "none") onChange({ kind: "none" });
    else if (k === "color") onChange({ kind: "color", color: value.kind === "color" ? value.color : BACKGROUND_COLORS[0] });
    else file.current?.click();
  };
  return (
    <>
      <span className="flex shrink-0 items-center gap-2">
        {value.kind === "photo" && (
          <button type="button" onClick={() => file.current?.click()} aria-label="Change photo" title="Change photo" className="size-7 shrink-0 overflow-hidden rounded-[7px] bg-chip shadow-[inset_0_0_0_1px_var(--line)]" style={src ? { background: `center / cover no-repeat url("${src}")` } : undefined} />
        )}
        {busy && <Loader2 size={15} className="animate-spin text-muted" aria-label="Uploading" />}
        <Seg
          label={label}
          value={value.kind}
          onChange={pick}
          options={[
            ["none", "None"],
            ["photo", "Photo"],
            ["color", "Colour"],
          ]}
        />
      </span>
      {value.kind === "color" && (
        <span role="radiogroup" aria-label="Colour" className="flex basis-full flex-wrap justify-end gap-1.5 pb-1">
          {BACKGROUND_COLORS.map((c) => {
            const on = value.color.toLowerCase() === c;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={c}
                onClick={() => onChange({ kind: "color", color: c })}
                className={cx("grid size-7 place-items-center rounded-full border", on ? "border-ink" : "border-transparent hover:border-line")}
              >
                <span className="grid size-[20px] place-items-center rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,.08)]" style={{ background: c }}>
                  {on && <Check size={12} strokeWidth={3} className="text-[#1c1c1c]" />}
                </span>
              </button>
            );
          })}
        </span>
      )}
      {error && <span className="basis-full pb-1 text-right text-[13px] text-bad">{error}</span>}
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
          setError(null);
          try {
            onChange(await uploadBackground(f));
          } catch (err) {
            setError((err as Error).message || "That photo didn't upload.");
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
