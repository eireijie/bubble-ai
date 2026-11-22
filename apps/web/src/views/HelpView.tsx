import { GITHUB_URL } from "@wisp/core";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, CircleHelp, ExternalLink } from "lucide-react";
import { helperChecklist, pickHelper, type HelperCheck } from "../onboarding.ts";
import { useDevices } from "../devices.ts";
import { go, href } from "../router.ts";
import { openDm } from "../openDm.ts";
import { useStore } from "../store.ts";
import { AgentAvatar, cx } from "../components/ui.tsx";

const ISSUES_URL = `${GITHUB_URL}/issues`;

const linkClass = "text-accent-text hover:underline rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40";
const rowClass = "w-full min-h-14 px-4 flex items-center gap-3 text-left text-[14px] font-medium text-ink hover:bg-hover outline-none focus-visible:bg-hover";

/** Help, short: ask your agent first, then why it might not be answering, the welcome again, and where to report a problem. */
export function HelpView({ onBack }: { onBack?: () => void }) {
  const agents = useStore((s) => s.agents);
  const devices = useDevices();
  const helper = pickHelper(agents, devices);
  const checks = helperChecklist(agents, devices);
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="mx-auto w-full max-w-xl h-15 shrink-0 px-4 md:px-8 md:mt-8 flex items-center gap-2 safe-top">
        {onBack && (
          <button className="md:hidden p-1.5 -ml-1.5 rounded-md hover:bg-hover" onClick={onBack} aria-label="Back">
            <ChevronLeft size={22} />
          </button>
        )}
        <h1 className="t-title flex-1 truncate">Help</h1>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-xl px-4 md:px-8 pt-2 pb-[max(2rem,env(safe-area-inset-bottom))] space-y-6">
          <div className="rounded-[14px] bg-card overflow-hidden">
            <button type="button" className={rowClass} onClick={() => (helper ? void openDm(helper.id) : go({ view: "welcome" }))}>
              {helper && <AgentAvatar agent={helper} size={34} />}
              <span className="flex-1 min-w-0 truncate">{helper ? `Ask ${helper.name}` : "Make your agent"}</span>
              <ChevronRight size={15} className="text-muted" aria-hidden />
            </button>
          </div>

          <section aria-labelledby="help-quiet" className="space-y-2">
            <h2 id="help-quiet" className="px-1 text-[13px] font-medium text-muted">
              My agent isn't answering
            </h2>
            <ul className="rounded-[14px] bg-card divide-y divide-line overflow-hidden" aria-busy={devices === null}>
              {checks.map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
            </ul>
          </section>

          <div className="rounded-[14px] bg-card divide-y divide-line overflow-hidden">
            <a className={rowClass} href={href({ view: "welcome", intro: true })}>
              <span className="flex-1">See the welcome again</span>
              <ChevronRight size={15} className="text-muted" aria-hidden />
            </a>
            <a className={rowClass} href={ISSUES_URL} target="_blank" rel="noreferrer">
              <span className="flex-1">Report a problem</span>
              <ExternalLink size={14} className="text-muted" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

const STATUS = {
  ok: { Icon: Check, tone: "text-ok", word: "Working" },
  bad: { Icon: AlertTriangle, tone: "text-warn", word: "Needs fixing" },
  unknown: { Icon: CircleHelp, tone: "text-faint", word: "Can't tell yet" },
} as const;

function CheckRow({ check }: { check: HelperCheck }) {
  const { Icon, tone, word } = STATUS[check.status];
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Icon size={16} className={cx("mt-0.5 shrink-0", tone)} aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <div className={check.status === "unknown" ? "text-muted" : undefined}>
          <span className="sr-only">{word}: </span>
          {check.label}
        </div>
        {check.status === "bad" && check.fix && <p className="mt-0.5 text-muted">{check.fix}</p>}
        {check.status === "bad" && check.to && (
          <a className={cx("mt-1 inline-block", linkClass)} href={href(check.to)}>
            Fix this
          </a>
        )}
      </div>
    </li>
  );
}
