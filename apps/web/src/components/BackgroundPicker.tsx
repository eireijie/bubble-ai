import { Loader2 } from "lucide-react";
import { Seg } from "../views/settings/rows.tsx";
import { colorGradient, shownColor, usePhotoSrc, type ChatBackground } from "../chatBackground.ts";
import { useAppearance } from "../theme.ts";
import { useBackgroundSheet } from "./BackgroundSheet.tsx";

type Kind = ChatBackground["kind"];

/**
 * None · Photo · Colour, small enough for a settings row (Settings' default for every chat). Photo
 * opens the file picker, then the preview sheet; Colour opens the preview sheet. Nothing is saved
 * until Set (BackgroundSheet.tsx). A colour or photo already set shows as a small chip that reopens it.
 */
export function BackgroundPicker({ value, onChange, label = "Background" }: { value: ChatBackground; onChange: (bg: ChatBackground) => Promise<void>; label?: string }) {
  const src = usePhotoSrc(value);
  const dark = useAppearance().resolvedMode === "dark";
  const sheet = useBackgroundSheet({ name: "Your chats", current: value, onSet: onChange });
  const pick = (k: Kind) => {
    if (k === "none") void onChange({ kind: "none" }).catch(() => {});
    else if (k === "color") sheet.openColour();
    else sheet.openPhoto();
  };
  const chip = value.kind === "photo" ? (src ? `center / cover no-repeat url("${src}")` : undefined) : value.kind === "color" ? colorGradient(shownColor(value.color, dark), dark) : undefined;
  return (
    <>
      <span className="flex shrink-0 items-center gap-2">
        {value.kind !== "none" && (
          <button
            type="button"
            onClick={value.kind === "photo" ? sheet.openPhoto : sheet.openColour}
            aria-label={value.kind === "photo" ? "Change photo" : "Change colour"}
            title={value.kind === "photo" ? "Change photo" : "Change colour"}
            className="size-7 shrink-0 overflow-hidden rounded-[7px] bg-chip shadow-[inset_0_0_0_1px_var(--line)]"
            style={chip ? { background: chip } : undefined}
          />
        )}
        {sheet.busy && <Loader2 size={15} className="animate-spin text-muted" aria-label="Uploading" />}
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
      {sheet.error && <span className="basis-full pb-1 text-right text-[13px] text-bad">{sheet.error}</span>}
      {sheet.node}
    </>
  );
}
