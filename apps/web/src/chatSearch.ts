/**
 * Opening a chat's search from outside the chat (round 11): the sidebar's right-click More asks for it,
 * and the chat opens its search as soon as it's showing (now, or once it has mounted).
 */
let pending: string | null = null;
export const CHAT_SEARCH = "bubble:chat-search";

export function requestChatSearch(channelId: string) {
  pending = channelId;
  window.dispatchEvent(new CustomEvent(CHAT_SEARCH, { detail: channelId }));
}

/** The chat takes a request meant for it, once. */
export function takeChatSearch(channelId: string): boolean {
  if (pending !== channelId) return false;
  pending = null;
  return true;
}
