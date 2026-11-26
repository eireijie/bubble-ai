import { api } from "./api.ts";
import { setDraft } from "./draft.ts";
import { go } from "./router.ts";
import { useStore } from "./store.ts";

/** Reuse an existing DM, or create it before navigating. A draft, if given, prefills its composer. */
export async function openDm(agentId: string, draft?: string) {
  const existing = useStore.getState().channels.find((c) => c.kind === "dm" && c.name.endsWith(`:${agentId}`));
  const id = existing?.id ?? (await api<{ id: string }>("POST", `/api/dm/${agentId}`)).id;
  if (!existing) await useStore.getState().refreshChannels();
  if (draft) setDraft(id, draft);
  go({ view: "chat", channelId: id, threadId: null });
}

/** Send an agent a message in your DM with it and go there, so you watch it answer. */
export async function askAgent(agentId: string, text: string) {
  const existing = useStore.getState().channels.find((c) => c.kind === "dm" && c.name.endsWith(`:${agentId}`));
  const id = existing?.id ?? (await api<{ id: string }>("POST", `/api/dm/${agentId}`)).id;
  if (!existing) await useStore.getState().refreshChannels();
  await api("POST", `/api/channels/${id}/messages`, { body: text, threadId: null, fileIds: [] });
  go({ view: "chat", channelId: id, threadId: null });
}

/**
 * New chat with an agent: its DM, where a fresh conversation starts ("/new") unless the one there is
 * already fresh (nothing said yet, or the last thing is the "Started a new conversation" line).
 */
export async function startNewChat(agentId: string) {
  const existing = useStore.getState().channels.find((c) => c.kind === "dm" && c.name.endsWith(`:${agentId}`));
  await openDm(agentId);
  const last = existing?.last;
  if (!existing || !last || last.body.trim() === "/new" || last.author.id === "system") return;
  await api("POST", `/api/channels/${existing.id}/messages`, { body: "/new", threadId: null, fileIds: [] }).catch(() => {});
}
