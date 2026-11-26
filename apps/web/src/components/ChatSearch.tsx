import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { Message } from "@bubble-ai/core";
import { useNames, useStore } from "../store.ts";
import { go } from "../router.ts";
import { Modal } from "./ui.tsx";

/** The messages loaded in a chat that say `query`, newest first (the same match the iPhone's Search in chat uses). */
export function chatMatches(messages: readonly Message[], query: string): Message[] {
  const q = query.trim().normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (!q) return [];
  const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return messages.filter((m) => !m.deletedAt && m.body && plain(m.body).includes(q)).reverse();
}

/** Search in chat: what's loaded here, newest first; picking one goes to the message and flashes it. */
export function ChatSearch({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const messages = useStore((s) => s.messages[channelId]);
  const names = useNames();
  const [query, setQuery] = useState("");
  const found = useMemo(() => chatMatches(messages ?? [], query), [messages, query]);
  return (
    <Modal title="Search in chat" onClose={onClose} contentClassName="!px-0 !pb-2">
      <div className="mx-4 mb-2 flex h-10 items-center gap-2 rounded-full bg-card px-3.5">
        <Search size={16} className="shrink-0 text-faint" aria-hidden />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search in chat" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint" />
      </div>
      <div className="max-h-[55vh] overflow-y-auto">
        {query.trim() && !found.length && <p className="px-4 py-6 text-center text-[14px] text-muted">Nothing here says that.</p>}
        {found.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => (onClose(), go({ view: "chat", channelId, threadId: null, messageId: m.id }))}
            className="block w-full px-4 py-2.5 text-left hover:bg-hover"
          >
            <span className="block text-[13px] font-semibold">{names.actorName(m.author.kind, m.author.id)}</span>
            <span className="line-clamp-2 text-[14px] text-muted">{m.body}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
