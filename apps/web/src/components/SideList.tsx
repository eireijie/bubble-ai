import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AppWindow, BellOff, Check, ChevronDown, ChevronRight, CircleDot, EyeOff, FolderInput, LogOut, PenLine, Pin, PinOff, Settings2, Trash2, X } from "lucide-react";
import { MAX_PINS, type SidebarLayout } from "@bubble-ai/core";
import { api } from "../api.ts";
import { useStore } from "../store.ts";
import { go, href } from "../router.ts";
import { openDm } from "../openDm.ts";
import { addSection, baseLayout, clearUnread, deleteSection, foldSection, forget, hide, markUnread, moveTo, movePin, newSectionName, NONE, pin, pinsFullNotice, placeChats, renameSection, unpin } from "../sidebarLayout.ts";
import { ChatAvatar, shortTime, type Chat, type PreviewLine } from "./ChatList.tsx";
import { ChannelSettings, leaveChannel, setChannelPrefs } from "./Channels.tsx";
import { ConfirmDialog } from "./InboxParts.tsx";
import { cx } from "./ui.tsx";

/**
 * The list of agents and teams (2026-11-25 "Bubble AI, bubbles", boards 3 and 7), the same on desktops
 * (in the sidebar) and phones (the Chats page): up to 9 pins in a 3×3 grid, an All / Your turn
 * filter, then the person's own sections (rename in place, fold, drag agents and teams between
 * them) and "No section". Right-click (press and hold on a phone) for the menu. Pins and sections
 * are kept per person in the hub, so every device shows the same list.
 */

const LEGACY_FOLDED = "wisp.chats.collapsed";
const DRAG = "text/x-wisp-chat";
const NEW_SECTION = "wisp:new-section";

/** "New section" from a + menu: the list adds one and puts its name up for editing. */
export function newSideSection() {
  window.dispatchEvent(new Event(NEW_SECTION));
}

const readJson = <T,>(k: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? "") as T;
  } catch {
    return fallback;
  }
};

/** The open menu: whose, where, and whether it opens to the left (a pin in the third column). */
type MenuAt = { key: string; x: number; y: number; left?: boolean };

/** A small blue dot for unread, the agent's own flag says when it needs you. */
/** The one mark a chat gets (round 4): a blue dot when its agent needs you or there's something unread. */
export const BLUE_DOT = "#0a84ff";
function BlueDot({ on }: { on: boolean }) {
  return <span aria-hidden className="side-dot" style={{ background: on ? BLUE_DOT : "transparent" }} />;
}

export function useSideLayout(chats: readonly Chat[]): [SidebarLayout, (next: SidebarLayout) => void] {
  const saved = useStore((s) => s.me?.prefs.sidebar);
  const sections = useStore((s) => s.sections);
  const layout = useMemo(() => baseLayout(saved, chats, sections, readJson(LEGACY_FOLDED, {})), [saved, chats, sections]);
  const save = (next: SidebarLayout) => {
    void useStore
      .getState()
      .setPrefs({ sidebar: next })
      .catch((e) => alert((e as Error).message));
  };
  return [layout, save];
}

export function SideList({ chats, lines, active, phone = false }: { chats: Chat[]; lines: Map<string, PreviewLine>; active: string | null; phone?: boolean }) {
  const me = useStore((s) => s.me)!;
  const clock = useStore((s) => s.me?.prefs.clock) ?? "auto";
  const guest = me.role === "guest";
  const [layout, save] = useSideLayout(chats);
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Chat | null>(null);
  const [settingsFor, setSettingsFor] = useState<Chat | null>(null);

  const byKey = useMemo(() => new Map(chats.map((c) => [c.key, c])), [chats]);
  const placed = useMemo(() => placeChats(layout, chats), [layout, chats]);
  const unreadMarks = useMemo(() => new Set(layout.unread ?? []), [layout.unread]);
  const isUnread = (c: Chat) => c.unread > 0 || unreadMarks.has(c.key);

  // opening a chat you marked unread clears the mark
  const activeKey = chats.find((c) => c.channel && c.channel.id === active)?.key;
  useEffect(() => {
    if (activeKey && unreadMarks.has(activeKey)) save(clearUnread(layout, activeKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  const open = (c: Chat) => (c.channel ? go({ view: "chat", channelId: c.channel.id, threadId: null }) : c.agent && void openDm(c.agent.id));
  const urlOf = (c: Chat) => (c.channel ? href({ view: "chat", channelId: c.channel.id, threadId: null }) : undefined);

  const doPin = (c: Chat) => {
    const next = pin(layout, c.key);
    if (!next) return setNotice(pinsFullNotice(c.name));
    setNotice(null);
    save(next);
    if (c.channel && !c.channel.starred) void setChannelPrefs(c.channel, { starred: true }).catch(() => {});
  };
  const doUnpin = (c: Chat) => {
    save(unpin(layout, c.key));
    if (c.channel?.starred) void setChannelPrefs(c.channel, { starred: false }).catch(() => {});
  };
  const doMove = (c: Chat, sectionId: string) => {
    const wasPinned = layout.pins.includes(c.key);
    save(sectionId === NONE ? moveTo(layout, c.key, "__none__") : moveTo(layout, c.key, sectionId));
    if (wasPinned && c.channel?.starred) void setChannelPrefs(c.channel, { starred: false }).catch(() => {});
  };
  const doNewSection = (c?: Chat) => {
    const id = `s${Date.now().toString(36)}`;
    save(addSection(layout, newSectionName(layout), id, c?.key));
    setEditing(id);
  };
  const newRef = useRef(doNewSection);
  newRef.current = doNewSection;
  useEffect(() => {
    const on = () => newRef.current();
    window.addEventListener(NEW_SECTION, on);
    return () => window.removeEventListener(NEW_SECTION, on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const doRename = async (c: Chat, name: string) => {
    setRenaming(null);
    const clean = name.trim();
    if (!clean || clean === c.name) return;
    try {
      if (c.kind === "dm" && c.agent) {
        await api("PATCH", `/api/agents/${c.agent.id}`, { name: clean.slice(0, 80) });
        await useStore.getState().refreshAgents();
      } else if (c.channel) {
        const slug = clean.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^[-_]+|-+$/g, "").slice(0, 80);
        if (!slug) return;
        await api("PATCH", `/api/channels/${c.channel.id}`, { name: slug });
        await useStore.getState().refreshChannels();
      }
    } catch (e) {
      alert((e as Error).message);
    }
  };
  const doDelete = async (c: Chat) => {
    if (c.kind === "dm" && c.agent) {
      await api("DELETE", `/api/agents/${c.agent.id}`);
      await useStore.getState().refreshAgents();
    } else if (c.channel) {
      await api("DELETE", `/api/channels/${c.channel.id}`);
      await useStore.getState().refreshChannels();
    }
    save(forget(layout, c.key));
    if (c.channel && c.channel.id === active) go({ view: "chats" });
  };

  // --- drag and drop (desktop) -------------------------------------------------------------------
  const dragProps = (c: Chat) =>
    phone || guest
      ? {}
      : {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.setData(DRAG, c.key);
            e.dataTransfer.effectAllowed = "move";
            setDragging(c.key);
          },
          onDragEnd: () => (setDragging(null), setHot(null)),
        };
  const dropProps = (target: string, onDrop: (key: string) => void) =>
    phone || guest
      ? {}
      : {
          onDragOver: (e: React.DragEvent) => {
            if (!e.dataTransfer.types.includes(DRAG)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (hot !== target) setHot(target);
          },
          onDragLeave: (e: React.DragEvent) => {
            if (!(e.currentTarget as Node).contains(e.relatedTarget as Node)) setHot((h) => (h === target ? null : h));
          },
          onDrop: (e: React.DragEvent) => {
            const key = e.dataTransfer.getData(DRAG);
            e.preventDefault();
            setHot(null);
            setDragging(null);
            if (key) onDrop(key);
          },
        };

  const menuFor = (c: Chat, e: { clientX: number; clientY: number; preventDefault: () => void }, left?: boolean) => {
    e.preventDefault();
    setMenu({ key: c.key, x: e.clientX, y: e.clientY, left });
  };
  const press = useLongPress((key, x, y) => setMenu({ key, x, y }));

  // --- pins ---------------------------------------------------------------------------------------
  const pinSize = 56;
  const pins = placed.pins.map((k) => byKey.get(k)!).filter(Boolean);
  const pinGrid = pins.length > 0 && (
    <div
      data-tour="pins"
      aria-label="Pinned"
      role="list"
      className={cx("side-pins grid grid-cols-3 gap-x-1 gap-y-1 rounded-[14px] px-0.5 pb-2 pt-1", hot === "pins" && "bg-[var(--wisp-soft,rgba(122,91,220,.10))]")}
      {...dropProps("pins", (key) => {
        const c = byKey.get(key);
        if (!c) return;
        if (layout.pins.includes(key)) return;
        doPin(c);
      })}
    >
      {pins.map((c, i) => {
        const line = lines.get(c.key);
        const unread = isUnread(c);
        const label = `${c.name}, pinned${c.unread > 0 ? `, ${c.unread} unread` : unread ? ", unread" : ""}${line?.working ? ", working" : ""}${line?.needs ? ", needs you" : ""}`;
        const isActive = !!c.channel && c.channel.id === active;
        return (
          <div key={c.key} role="listitem" className={cx("relative", dragging === c.key && "opacity-40")}>
            <a
              href={urlOf(c) ?? "#"}
              onClick={(e) => {
                if (!c.channel) {
                  e.preventDefault();
                  open(c);
                }
              }}
              onContextMenu={(e) => menuFor(c, e, i % 3 === 2)}
              {...press(c.key)}
              {...dragProps(c)}
              {...dropProps(`pin:${c.key}`, (key) => layout.pins.includes(key) && save(movePin(layout, key, i)))}
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
              className={cx("press-row flex h-[88px] flex-col items-center justify-center gap-[5px] rounded-[14px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40", isActive ? "side-row-on" : "hover:bg-side-hover")}
            >
              <span className="relative grid place-items-center" style={{ width: pinSize, height: pinSize }}>
                <ChatAvatar chat={c} size={pinSize} />
                {(line?.needs || unread) && <span aria-hidden className="side-pin-dot" style={{ background: BLUE_DOT }} />}
              </span>
              {renaming === c.key ? (
                <RenameField value={c.name} onDone={(v) => void doRename(c, v)} className="w-[92px] text-center text-[14px]" />
              ) : (
                <span className={cx("max-w-[88px] truncate text-[12.5px] font-medium", unread || line?.needs ? "text-ink" : "text-ink/80")}>{c.name}</span>
              )}
            </a>
          </div>
        );
      })}
    </div>
  );

  // --- rows ---------------------------------------------------------------------------------------
  const rowH = phone ? 76 : 64;
  const avatar = phone ? 48 : 40;
  const row = (c: Chat) => {
    const line = lines.get(c.key);
    const unread = isUnread(c);
    const isActive = !!c.channel && c.channel.id === active;
    const label = `${c.name}${c.unread > 0 ? `, ${c.unread} unread` : unread ? ", unread" : ""}${line?.working ? ", working" : ""}${line?.needs ? ", needs you" : ""}`;
    return (
      <div key={c.key} className={cx("relative", dragging === c.key && "opacity-35")}>
        <a
          href={urlOf(c) ?? "#"}
          onClick={(e) => {
            if (!c.channel) {
              e.preventDefault();
              open(c);
            }
          }}
          onContextMenu={(e) => menuFor(c, e)}
          {...press(c.key)}
          {...dragProps(c)}
          aria-label={label}
          aria-current={isActive ? "page" : undefined}
          data-tour="chat-row"
          data-needs={line?.needs ? "" : undefined}
          className={cx("press-row group/row flex w-full items-center gap-2 rounded-[12px] pl-1 pr-3 text-left outline-none transition-[background-color,transform] duration-150 ease-out active:scale-[0.985] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40", isActive ? "side-row-on" : menu?.key === c.key ? "bg-side-active" : "hover:bg-side-hover")}
          style={{ height: rowH }}
        >
          <BlueDot on={!!line?.needs || unread} />
          {c.agent ? (
            // the agent's avatar opens its profile; the rest of the row opens the chat
            <span
              role="button"
              tabIndex={-1}
              aria-label={`${c.agent.name}'s profile`}
              title={`${c.agent.name}'s profile`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                go({ view: "agents", agentId: c.agent!.id, tab: "overview" });
              }}
              className="relative grid shrink-0 cursor-pointer place-items-center outline-none"
              style={{ width: avatar, height: avatar }}
            >
              <ChatAvatar chat={c} size={avatar} />
            </span>
          ) : (
            <span className="relative grid shrink-0 place-items-center" style={{ width: avatar, height: avatar }}>
              <ChatAvatar chat={c} size={avatar} />
            </span>
          )}
          <span className={cx("ml-1 flex h-full min-w-0 flex-1 flex-col justify-center gap-px", c.muted && "opacity-60")}>
            <span className="flex items-baseline gap-2">
              {renaming === c.key ? (
                <RenameField value={c.name} onDone={(v) => void doRename(c, v)} className="min-w-0 flex-1 text-[15px] font-semibold" />
              ) : (
                <span className={cx("min-w-0 flex-1 truncate font-semibold", phone ? "text-[17px]" : "text-[15px]", "text-ink")}>{c.name}</span>
              )}
              {c.at > 0 && <span className={cx("shrink-0", phone ? "text-[14px]" : "text-[13px]", "text-muted")}>{shortTime(c.at, clock)}</span>}
            </span>
            {line?.text && (
              <span className={cx("flex min-w-0 items-start gap-1.5 text-[15px] leading-5", line.working ? "text-wisp-strong" : "text-muted")}>
                {line.icon && <span className="inline-flex h-5 shrink-0 items-center">{line.icon}</span>}
                <span className={cx(phone ? "line-clamp-2 break-words" : "truncate", line.working && "shimmer-text")}>{line.text}</span>
              </span>
            )}
          </span>
        </a>
      </div>
    );
  };

  // --- sections -----------------------------------------------------------------------------------
  const sectionBlock = (s: (typeof placed.sections)[number]) => {
    const isHot = hot === `sec:${s.id}`;
    const dragName = dragging ? byKey.get(dragging)?.name : null;
    const isEditing = editing === s.id && !s.none;
    return (
      <section key={s.id} aria-label={s.name} className={cx("flex flex-col rounded-[12px]", isHot && s.keys.length > 0 && "bg-[var(--wisp-soft,rgba(122,91,220,.10))]")} {...dropProps(`sec:${s.id}`, (key) => byKey.get(key) && doMove(byKey.get(key)!, s.id))}>
        {s.none && layout.sections.length === 0 ? null : isEditing ? (
          <div className="flex h-[34px] items-center gap-1.5 pl-2.5 pr-2">
            <ChevronDown size={14} strokeWidth={2.2} className="shrink-0 text-muted" aria-hidden />
            <RenameField
              value={layout.sections.find((x) => x.id === s.id)?.name ?? s.name}
              onDone={(v) => {
                setEditing(null);
                save(renameSection(layout, s.id, v));
              }}
              className="h-[26px] flex-1 rounded-[7px] bg-[var(--control,var(--panel))] px-2 text-[13px] font-semibold shadow-[inset_0_0_0_1.5px_var(--wisp)]"
            />
          </div>
        ) : (
          <SectionHeader
            // the chats outside your sections, under your sections: "Other", with no count beside it
            name={s.none ? "Other" : s.name}
            count={s.none ? 0 : s.keys.length}
            folded={s.folded}
            phone={phone}
            canEdit={!guest && !s.none}
            onToggle={() => save(foldSection(layout, s.id, !s.folded))}
            onRename={() => setEditing(s.id)}
            onDelete={() => save(deleteSection(layout, s.id))}
          />
        )}
        {!s.folded && s.keys.map((k) => byKey.get(k)).filter((c): c is Chat => !!c).map(row)}
        {!s.folded && !s.none && s.keys.length === 0 && (
          <div className={cx("mx-1 mb-1.5 mt-0.5 grid h-[52px] place-items-center rounded-[12px] border-[1.5px] border-dashed text-[13px]", isHot ? "border-wisp bg-[var(--wisp-soft,rgba(122,91,220,.10))] font-semibold text-wisp-strong" : "border-line2 text-muted")}>
            {isHot && dragName ? `Drop to move ${dragName} here` : phone ? "Hold an agent, then drag it here" : "Drag agents or teams here"}
          </div>
        )}
      </section>
    );
  };

  const shownSections = placed.sections.filter((s) => !s.none || s.keys.length > 0 || placed.sections.length === 1);
  const menuChat = menu ? byKey.get(menu.key) : undefined;

  return (
    // the tour's "blue dot" stop points at the whole list (tour.ts)
    <div data-tour="yourturn" className="flex flex-col">
      {notice && (
        <div role="status" className="m-pop mx-0.5 mb-2 flex items-center gap-2.5 rounded-[12px] bg-panel px-3 py-2.5 text-[13px] text-ink shadow-[0_12px_36px_rgba(0,0,0,.16),0_0_0_1px_rgba(0,0,0,.06)]">
          <Pin size={15} strokeWidth={2} className="shrink-0 text-muted" aria-hidden />
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="rounded px-1 py-0.5 font-semibold hover:bg-hover">
            OK
          </button>
        </div>
      )}
      {pinGrid}
      <div data-tour="sections" className="flex flex-col gap-0.5">
        {shownSections.map(sectionBlock)}
        {/* New section is in the + menu, once */}
      </div>

      {menu && menuChat && (
        <SideMenu
          chat={menuChat}
          at={menu}
          phone={phone}
          guest={guest}
          pinned={layout.pins.includes(menuChat.key)}
          pinsFull={layout.pins.length >= MAX_PINS}
          unread={isUnread(menuChat)}
          sections={layout.sections}
          here={layout.sections.find((s) => s.items.includes(menuChat.key))?.id ?? NONE}
          onClose={() => setMenu(null)}
          onPin={() => doPin(menuChat)}
          onUnpin={() => doUnpin(menuChat)}
          onMove={(id) => doMove(menuChat, id)}
          onNewSection={() => doNewSection(menuChat)}
          onMarkUnread={() => save(markUnread(layout, menuChat.key))}
          onMarkRead={() => {
            save(clearUnread(layout, menuChat.key));
            if (menuChat.channel?.unread) useStore.getState().markRead(menuChat.channel.id);
          }}
          onNewWindow={() => {
            const url = urlOf(menuChat);
            if (url) window.open(url, "_blank", "noopener");
          }}
          onRename={() => setRenaming(menuChat.key)}
          onHide={() => save(hide(layout, menuChat.key))}
          onMute={() => menuChat.channel && void setChannelPrefs(menuChat.channel, { notify: menuChat.channel.notify === "mute" ? "default" : "mute" })}
          onTeamSettings={() => setSettingsFor(menuChat)}
          onLeave={() => menuChat.channel && void leaveChannel(menuChat.channel)}
          onDelete={() => setConfirm(menuChat)}
        />
      )}
      {confirm && (
        <DeleteConfirm chat={confirm} onClose={() => setConfirm(null)} onDelete={() => doDelete(confirm)} />
      )}
      {settingsFor?.channel && createPortal(<ChannelSettings channel={settingsFor.channel} onClose={() => setSettingsFor(null)} />, document.body)}
    </div>
  );
}

function DeleteConfirm({ chat, onClose, onDelete }: { chat: Chat; onClose: () => void; onDelete: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const team = chat.kind === "team";
  return (
    <ConfirmDialog
      title={`Delete ${chat.name}?`}
      body={
        <>
          {team ? "Its messages and threads are deleted for everyone. This can't be undone." : "Its notes and personality stay in memory. Its schedules and chats stop."}
          {error && <span className="mt-2 block text-bad">{error}</span>}
        </>
      }
      confirm="Delete"
      keep="Keep it"
      danger
      busy={busy}
      onClose={onClose}
      onConfirm={() => {
        setBusy(true);
        setError(null);
        onDelete().then(onClose, (e) => (setError((e as Error).message), setBusy(false)));
      }}
    />
  );
}

/** A name field that saves on Enter or when it loses focus, and puts the old name back on Escape. */
function RenameField({ value, onDone, className }: { value: string; onDone: (v: string) => void; className?: string }) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (val: string) => {
    if (done.current) return;
    done.current = true;
    onDone(val);
  };
  return (
    <input
      ref={ref}
      value={v}
      maxLength={40}
      aria-label="Name"
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => (e.preventDefault(), e.stopPropagation())}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(v);
        else if (e.key === "Escape") finish(value);
      }}
      onBlur={() => finish(v)}
      className={cx("bg-transparent text-ink outline-none", className)}
    />
  );
}

function SectionHeader({ name, count, folded, phone, canEdit, onToggle, onRename, onDelete }: { name: string; count: number; folded: boolean; phone: boolean; canEdit: boolean; onToggle: () => void; onRename: () => void; onDelete: () => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        onDoubleClick={canEdit ? (e) => (e.preventDefault(), onRename()) : undefined}
        onContextMenu={canEdit ? (e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY })) : undefined}
        aria-expanded={!folded}
        className={cx("flex items-center gap-1.5 rounded-[10px] pl-2.5 pr-2 text-left font-medium text-muted outline-none hover:bg-side-hover focus-visible:ring-2 focus-visible:ring-ring/40", phone ? "h-9 text-[15px]" : "h-[34px] text-[15px]")}
      >
        <ChevronDown size={14} strokeWidth={2.2} aria-hidden className={cx("shrink-0 transition-transform duration-200", folded && "-rotate-90")} />
        <span className="truncate">{name}</span>
        {count > 0 && <span className="font-normal">{count}</span>}
      </button>
      {menu && (
        <Pop at={menu} onClose={() => setMenu(null)} label={name}>
          {(close) => (
            <>
              <Item icon={<PenLine size={16} />} onClick={() => (close(), onRename())}>
                Rename section
              </Item>
              <Item icon={<Trash2 size={16} />} danger onClick={() => (close(), onDelete())}>
                Delete section
              </Item>
            </>
          )}
        </Pop>
      )}
    </>
  );
}

/** The right-click menu (board 7): Pin, Move to section ›, Mark as unread, Open in new window, Rename, Hide, Delete. */
function SideMenu(p: {
  chat: Chat;
  at: MenuAt;
  phone: boolean;
  guest: boolean;
  pinned: boolean;
  pinsFull: boolean;
  unread: boolean;
  sections: SidebarLayout["sections"];
  here: string;
  onClose: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onMove: (sectionId: string) => void;
  onNewSection: () => void;
  onMarkUnread: () => void;
  onMarkRead: () => void;
  onNewWindow: () => void;
  onRename: () => void;
  onHide: () => void;
  onMute: () => void;
  onTeamSettings: () => void;
  onLeave: () => void;
  onDelete: () => void;
}) {
  const [moving, setMoving] = useState(false);
  const { chat } = p;
  const team = chat.kind === "team";
  const muted = chat.channel?.notify === "mute";
  return (
    <Pop at={p.at} onClose={p.onClose} label={chat.name} left={p.at.left} phone={p.phone}>
      {(close) => (
        <>
          {p.pinned ? (
            <Item icon={<PinOff size={16} />} onClick={() => (close(), p.onUnpin())}>
              Unpin
            </Item>
          ) : (
            <Item icon={<Pin size={16} />} hint={p.pinsFull ? `${MAX_PINS} of ${MAX_PINS}` : undefined} onClick={() => (close(), p.onPin())}>
              Pin
            </Item>
          )}
          {!p.guest && (
            <Item icon={<FolderInput size={16} />} more={<ChevronRight size={15} className={cx("text-faint transition-transform", moving && "rotate-90")} />} onClick={() => setMoving((m) => !m)} expanded={moving}>
              Move to section
            </Item>
          )}
          {moving && (
            <div className="flex flex-col pb-1 pl-[26px] pt-0.5">
              {[...p.sections.map((s) => ({ id: s.id, name: s.name })), { id: NONE, name: "No section" }].map((s) => (
                <Item key={s.id} small onClick={() => (close(), p.onMove(s.id))} more={p.here === s.id ? <Check size={15} className="text-wisp-strong" /> : undefined}>
                  {s.name}
                </Item>
              ))}
              <Item small muted onClick={() => (close(), p.onNewSection())}>
                New section…
              </Item>
            </div>
          )}
          {p.unread ? (
            <Item icon={<CircleDot size={16} />} onClick={() => (close(), p.onMarkRead())}>
              Mark as read
            </Item>
          ) : (
            <Item icon={<CircleDot size={16} />} onClick={() => (close(), p.onMarkUnread())}>
              Mark as unread
            </Item>
          )}
          {chat.channel && !p.phone && (
            <Item icon={<AppWindow size={16} />} onClick={() => (close(), p.onNewWindow())}>
              Open in new window
            </Item>
          )}
          {!p.guest && (
            <Item icon={<PenLine size={16} />} onClick={() => (close(), p.onRename())}>
              Rename
            </Item>
          )}
          <Item icon={<EyeOff size={16} />} onClick={() => (close(), p.onHide())}>
            Hide from sidebar
          </Item>
          {chat.channel && (
            <Item icon={<BellOff size={16} />} onClick={() => (close(), p.onMute())}>
              {muted ? "Unmute" : "Mute"}
            </Item>
          )}
          {team && !p.guest && (
            <Item icon={<Settings2 size={16} />} onClick={() => (close(), p.onTeamSettings())}>
              Team settings
            </Item>
          )}
          {team && chat.channel?.joined && chat.channel.name !== "general" && (
            <Item icon={<LogOut size={16} />} onClick={() => (close(), p.onLeave())}>
              Leave team
            </Item>
          )}
          {!p.guest && (
            <>
              <div className="mx-2 my-[5px] h-px bg-line2" />
              <Item icon={<Trash2 size={16} />} danger onClick={() => (close(), p.onDelete())}>
                Delete
              </Item>
            </>
          )}
        </>
      )}
    </Pop>
  );
}

function Item({ icon, children, onClick, danger, more, hint, small, muted, expanded }: { icon?: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean; more?: ReactNode; hint?: string; small?: boolean; muted?: boolean; expanded?: boolean }) {
  return (
    <button type="button" role="menuitem" aria-expanded={expanded} onClick={onClick} className={cx("flex w-full items-center gap-2.5 rounded-[9px] px-2.5 text-left outline-none hover:bg-hover focus-visible:bg-hover", small ? "h-[30px] text-[13px]" : "h-[34px] text-[14px]", danger ? "text-[#ff453a]" : muted ? "text-muted" : "text-ink")}>
      {icon && <span className="grid shrink-0 opacity-80">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="text-[13px] text-muted">{hint}</span>}
      {more}
    </button>
  );
}

/** A floating menu at a point; opens to the left of it when `left` (a pin in the third column). Phones: a sheet low in the middle. */
function Pop({ at, onClose, label, left, phone, children }: { at: { x: number; y: number }; onClose: () => void; label: string; left?: boolean; phone?: boolean; children: (close: () => void) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ left: at.x, top: at.y, visibility: "hidden" });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const x = phone ? (window.innerWidth - r.width) / 2 : left ? at.x - r.width : at.x;
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(at.y, window.innerHeight - r.height - 8)) });
  }, [at.x, at.y, left, phone]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", k);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  return createPortal(
    <div className={cx("fixed inset-0 z-[90]", phone && "m-scrim bg-black/45 backdrop-blur-[6px]")} onMouseDown={(e) => e.target === e.currentTarget && onClose()} onContextMenu={(e) => (e.preventDefault(), onClose())} onTouchStart={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="menu" aria-label={label} style={{ position: "fixed", ...pos }} className="m-menu flex w-[228px] flex-col rounded-[12px] bg-panel p-1.5 shadow-[0_12px_36px_rgba(0,0,0,.16),0_0_0_1px_rgba(0,0,0,.06)] dark:bg-[#1f1f1f] dark:shadow-[0_12px_36px_rgba(0,0,0,.6),0_0_0_1px_rgba(255,255,255,.08)]">
        {phone && (
          <div className="flex items-center gap-2 px-2.5 pb-1 pt-1.5">
            <span className="flex-1 truncate text-[14px] font-semibold">{label}</span>
            <button type="button" onClick={onClose} aria-label="Close" className="grid size-7 place-items-center rounded-[8px] text-muted hover:bg-hover">
              <X size={15} />
            </button>
          </div>
        )}
        {children(onClose)}
      </div>
    </div>,
    document.body,
  );
}

/** Press and hold (phones) opens the menu at the finger. */
function useLongPress(onPress: (key: string, x: number, y: number) => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => clearTimeout(timer.current);
  return (key: string) => ({
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY };
      timer.current = setTimeout(() => onPress(key, t.clientX, t.clientY), 480);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const t = e.touches[0];
      if (start.current && Math.hypot(t.clientX - start.current.x, t.clientY - start.current.y) > 8) cancel();
    },
    onTouchEnd: cancel,
    onTouchCancel: cancel,
  });
}
