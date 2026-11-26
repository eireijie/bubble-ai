import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { TEAM_TEMPLATES, type TeamTemplate } from "@bubble-ai/core";
import { api } from "../api.ts";
import { Button, Modal, cx } from "../components/ui.tsx";
import { MiniChart } from "./How.tsx";
import { SeedGhost, useIsPhone } from "./parts.tsx";

/** The ready-made teams, then the ones people here saved from their own. */
export function useTemplates(): { all: TeamTemplate[]; own: Set<string>; remove: (id: string) => Promise<void> } {
  const [own, setOwn] = useState<TeamTemplate[]>([]);
  useEffect(() => {
    api<TeamTemplate[]>("GET", "/api/team-templates")
      .then(setOwn)
      .catch(() => {});
  }, []);
  const builtIn = new Set(TEAM_TEMPLATES.map((t) => t.id));
  return {
    all: [...TEAM_TEMPLATES, ...own.filter((t) => !builtIn.has(t.id))],
    own: new Set(own.map((t) => t.id)),
    remove: async (id) => {
      await api("DELETE", `/api/team-templates/${id}`);
      setOwn((cur) => cur.filter((t) => t.id !== id));
    },
  };
}

function Sample({ template }: { template: TeamTemplate }) {
  if (!template.sample?.length) return null;
  return (
    <div className="space-y-2.5">
      {template.sample.map((line, i) => {
        const you = line.who === "You";
        return (
          <div key={i} className={cx("flex items-end gap-2", you && "justify-end")}>
            {!you && <SeedGhost seed={line.who} size={26} />}
            <div className={cx("max-w-[80%]", you && "text-right")}>
              {!you && <div className="px-2 pb-0.5 text-[12px] text-faint">{line.who}</div>}
              <div className={cx("inline-block rounded-[12px] px-3.5 py-2 text-left text-[14px] leading-snug", you ? "bg-badge text-badge-ink" : "bg-chip")}>{line.text}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One template: its steps as a small chart, and a sample of how a request goes. */
function Detail({ template, own, onDelete }: { template: TeamTemplate; own: boolean; onDelete: () => void }) {
  return (
    <div className="min-w-0 flex-1 space-y-4">
      <div className="rounded-[12px] bg-card px-4 py-3" aria-label="Who hands to whom">
        <MiniChart steps={template.steps} />
      </div>
      {!!template.sample?.length && (
        <div className="rounded-[12px] bg-card p-4" aria-label="How a request goes">
          <Sample template={template} />
        </div>
      )}
      {own && (
        <button type="button" onClick={onDelete} className="inline-flex min-h-8 items-center gap-1.5 text-[13px] text-bad hover:underline">
          <Trash2 size={14} aria-hidden /> Delete template
        </button>
      )}
    </div>
  );
}

/** Ready-made teams: a list of names (a row of them at phone width), and for the picked one a small flowchart and a sample of how it sounds. */
export function TemplateBrowser({ title = "Templates", onClose, onUse }: { title?: string; onClose: () => void; onUse: (t: TeamTemplate) => void }) {
  const { all, own, remove } = useTemplates();
  const phone = useIsPhone();
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const current = all[Math.min(page, all.length - 1)];
  return (
    <Modal title={title} onClose={onClose} label={title} className="sm:max-w-[960px]!">
      <div className={cx("flex", phone ? "flex-col gap-4" : "min-h-[440px] gap-6")}>
        <div role="listbox" aria-label="Templates" className={phone ? "-mx-5 flex gap-1.5 overflow-x-auto px-5" : "w-[260px] shrink-0 space-y-0.5"}>
          {all.map((t, i) =>
            phone ? (
              <button key={t.id} type="button" role="option" aria-selected={i === page} onClick={() => setPage(i)} className={cx("h-9 shrink-0 rounded-[8px] px-3.5 text-[13px] font-medium", i === page ? "bg-side-active" : "border border-line")}>
                {t.name}
              </button>
            ) : (
              <button key={t.id} type="button" role="option" aria-selected={i === page} onClick={() => setPage(i)} className={cx("w-full rounded-[10px] px-3 py-2 text-left", i === page ? "bg-side-active" : "hover:bg-hover")}>
                <span className="block text-[14px] font-medium">{t.name}</span>
                <span className="block text-[13px] leading-[18px] text-muted">{t.blurb}</span>
              </button>
            ),
          )}
        </div>
        {current && (
          <Detail
            template={current}
            own={own.has(current.id)}
            onDelete={() => remove(current.id).then(() => setPage((p) => Math.max(0, p - 1)), (e) => setError((e as Error).message))}
          />
        )}
      </div>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      <div className="sticky bottom-0 -mx-5 mt-5 flex justify-end gap-2.5 bg-panel px-5 pb-1 pt-3">
        <Button type="button" variant="primary" onClick={() => current && onUse(current)} disabled={!current}>
          Use
        </Button>
      </div>
    </Modal>
  );
}
