import { useMemo, type ReactNode } from "react";
import { MoreHorizontal, X } from "lucide-react";
import { newBubbleLook } from "@bubble-ai/core/src/appearance.ts";
import type { TeamTemplate } from "@bubble-ai/core";
import { Ghost } from "../components/Ghost.tsx";
import { GoPill } from "../components/ConnectParts.tsx";
import { Menu, Modal, cx } from "../components/ui.tsx";
import { useIsPhone } from "../team/parts.tsx";
import type { AgentType } from "./onboarding/agentTypes.ts";
import { AGENT_TINT, TEAM_TINTS, agentsWord, teamCast, type CastMember } from "./marketTemplateData.ts";

/**
 * The Marketplace's Agents and Teams (round 12, boards 15 and 15b): the agent templates first-run
 * setup offers, each with Use (New agent, filled in), and the ready-made teams with the person's
 * own saved ones first, each opening a sheet of who is in it before Use this team.
 */

/** A plain bubble of one colour: round, dot eyes, nothing to wear. */
function Bubble({ color, size }: { color: string; size: number }) {
  const look = useMemo(() => ({ ...newBubbleLook(() => 0), color }), [color]);
  return <Ghost look={look} size={size} animate={false} ambient={false} trackPointer={false} label="" />;
}

/** A section's "Show all" at the right of its title. */
export function ShowAll({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="-my-2 py-2 text-[13px] text-muted outline-none hover:text-ink focus-visible:underline">
      Show all
    </button>
  );
}

/** Agent templates, two to a line: the bubble, the name, what it handles and Use. */
export function AgentCards({ list, canEdit, onUse }: { list: AgentType[]; canEdit: boolean; onUse: (t: AgentType) => void }) {
  return (
    <div className="mx-3 grid grid-cols-1 gap-2.5 md:grid-cols-2">
      {list.map((t) => (
        <div key={t.id} className="flex min-w-0 items-center gap-3 rounded-[14px] bg-card px-3.5 py-3">
          <Bubble color={AGENT_TINT[t.id] ?? TEAM_TINTS[0]} size={44} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14.5px] font-semibold leading-5">{t.name}</div>
            <div className="mt-0.5 truncate text-[12.5px] leading-[17px] text-muted">{t.sub}</div>
          </div>
          {canEdit && (
            <GoPill onClick={() => onUse(t)} aria-label={`Use ${t.name}`} className="font-semibold">
              Use
            </GoPill>
          )}
        </div>
      ))}
    </div>
  );
}

/** A row of overlapping bubbles, four at most and "+N" for the rest. */
export function BubbleStack({ cast, size, overlap, max = 4, ring = "var(--card)" }: { cast: CastMember[]; size: number; overlap: number; max?: number; ring?: string }) {
  const shown = cast.slice(0, max);
  return (
    <span className="flex items-center" aria-hidden>
      {shown.map((m, i) => (
        <span key={m.key} className="flex rounded-full" style={{ marginLeft: i ? -overlap : 0, boxShadow: `0 0 0 2px ${ring}` }}>
          <Bubble color={m.color} size={size} />
        </span>
      ))}
      {cast.length > max && <span className="ml-1.5 text-[12px] text-muted">+{cast.length - max}</span>}
    </span>
  );
}

/** Team templates, three to a line: the bubbles, how many agents, the name and its blurb. The person's own come first, marked "yours", with Delete in their menu. */
export function TeamCards({ list, own, canEdit, onOpen, onDelete }: { list: TeamTemplate[]; own: Set<string>; canEdit: boolean; onOpen: (t: TeamTemplate) => void; onDelete: (t: TeamTemplate) => void }) {
  return (
    <div className="mx-3 grid grid-cols-1 gap-2.5 md:grid-cols-3">
      {list.map((t) => {
        const cast = teamCast(t);
        const mine = own.has(t.id);
        return (
          <div
            key={t.id}
            role="button"
            tabIndex={0}
            aria-label={t.name}
            onClick={() => onOpen(t)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), onOpen(t))}
            className="flex min-w-0 cursor-pointer flex-col gap-[9px] rounded-[14px] bg-card p-3.5 text-left outline-none hover:brightness-[1.04] focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <div className="flex items-center justify-between gap-2">
              <BubbleStack cast={cast} size={30} overlap={10} />
              <span className="flex items-center gap-1 text-[12px] text-muted">
                {agentsWord(cast.length)}
                {mine && " · yours"}
                {mine && canEdit && (
                  // the menu is drawn in a portal, but React still bubbles its clicks through here: keep them off the card
                  <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="-my-1.5 -mr-1.5">
                    <Menu
                      align="right"
                      items={[{ label: "Delete template", danger: true, onSelect: () => onDelete(t) }]}
                      trigger={(open, toggle) => (
                        <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu" aria-label={`More for ${t.name}`} className="grid size-7 place-items-center rounded-full text-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/40">
                          <MoreHorizontal size={16} strokeWidth={1.8} aria-hidden />
                        </button>
                      )}
                    />
                  </span>
                )}
              </span>
            </div>
            <div className="truncate text-[14.5px] font-semibold leading-5">{t.name}</div>
            <div className="line-clamp-2 h-[34px] text-[12.5px] leading-[17px] text-muted">{t.blurb || (mine ? "Your own team." : "")}</div>
          </div>
        );
      })}
    </div>
  );
}

/** A team, opened: its bubbles, name and blurb, each role and its job, and one Use this team. A sheet on a phone, a pop-up on a desktop; both open instantly. */
export function TeamSheet({ template, canEdit, onClose, onUse }: { template: TeamTemplate; canEdit: boolean; onClose: () => void; onUse: () => void }) {
  const phone = useIsPhone();
  const cast = teamCast(template);
  const body: ReactNode = (
    <div className="flex flex-col">
      {phone ? <div className="mb-3.5 h-[5px] w-9 self-center rounded-[3px] bg-line" aria-hidden /> : (
        <button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)" className="ibtn -mr-2 -mt-1 self-end">
          <X size={17} strokeWidth={1.8} />
        </button>
      )}
      <div className="self-center">
        <BubbleStack cast={cast} size={44} overlap={14} ring="var(--panel)" />
      </div>
      <h2 className="mt-3 text-center text-[21px] font-bold leading-7">{template.name}</h2>
      {template.blurb && <p className="mx-2.5 mt-1 text-center text-[13.5px] leading-[19px] text-muted">{template.blurb}</p>}
      <ul className="mt-4 flex flex-col gap-0.5" aria-label="Who is on it">
        {cast.map((m) => (
          <li key={m.key} className="flex min-h-[50px] items-center gap-[11px]">
            <Bubble color={m.color} size={34} />
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold leading-5">{m.name}</div>
              {m.job && <div className="truncate text-[12.5px] leading-[17px] text-muted">{m.job}</div>}
            </div>
          </li>
        ))}
      </ul>
      {canEdit && (
        <>
          <button type="button" onClick={onUse} className="mt-5 h-12 w-full rounded-full bg-ink text-[15px] font-semibold text-panel outline-none hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/40">
            Use this team
          </button>
          <p className="mt-2.5 text-center text-[12.5px] text-muted">Opens the team builder, ready to change</p>
        </>
      )}
    </div>
  );
  return (
    <Modal title={template.name} label={template.name} headerless still onClose={onClose} className={cx("sm:max-w-[400px]!", phone && "rounded-t-[26px]!")} contentClassName="px-[18px]! pt-[18px] pb-[max(1.5rem,env(safe-area-inset-bottom))]! sm:px-6! sm:pb-6!">
      {body}
    </Modal>
  );
}
