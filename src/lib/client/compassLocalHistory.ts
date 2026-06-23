import type { ChatSource } from "@/components/chat/chatUiStateTypes";

export type CompassLocalConversation = {
  id: string;
  conversation_id: string;
  user_message: string;
  ai_response: string;
  sources: ChatSource[];
  created_at: string;
  updated_at: string;
  localOnly: true;
};

export const COMPASS_CONVERSATION_HISTORY_LIMIT = 25;

function getStorageKey(userId: string) {
  return `admate-compass:conversation-history:${userId}`;
}

function canUseLocalStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isCompassLocalConversation(item: unknown): item is CompassLocalConversation {
  return Boolean(
    item
    && typeof item === "object"
    && typeof (item as CompassLocalConversation).conversation_id === "string"
    && typeof (item as CompassLocalConversation).user_message === "string"
    && typeof (item as CompassLocalConversation).ai_response === "string"
  );
}

function normalizeCompassLocalConversations(input: unknown): CompassLocalConversation[] {
  if (!Array.isArray(input)) return [];

  return input
    .filter(isCompassLocalConversation)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, COMPASS_CONVERSATION_HISTORY_LIMIT);
}

export function loadCompassLocalConversations(userId: string): CompassLocalConversation[] {
  if (!userId || !canUseLocalStorage()) return [];

  try {
    const raw = window.localStorage.getItem(getStorageKey(userId));
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    const normalized = normalizeCompassLocalConversations(parsed);

    if (!Array.isArray(parsed) || normalized.length !== parsed.length || normalized.some((item, index) => item !== parsed[index])) {
      window.localStorage.setItem(getStorageKey(userId), JSON.stringify(normalized));
    }

    return normalized;
  } catch (error) {
    console.warn("로컬 Compass 히스토리를 읽지 못했습니다.", error);
    return [];
  }
}

export function saveCompassLocalConversation(
  userId: string,
  input: {
    conversationId: string;
    userMessage: string;
    aiResponse: string;
    sources?: ChatSource[];
  }
) {
  if (!userId || !canUseLocalStorage()) return false;

  try {
    const now = new Date().toISOString();
    const current = loadCompassLocalConversations(userId);
    const nextItem: CompassLocalConversation = {
      id: input.conversationId,
      conversation_id: input.conversationId,
      user_message: input.userMessage,
      ai_response: input.aiResponse,
      sources: input.sources || [],
      created_at: now,
      updated_at: now,
      localOnly: true,
    };

    const next = [
      nextItem,
      ...current.filter(item => item.conversation_id !== input.conversationId),
    ].slice(0, COMPASS_CONVERSATION_HISTORY_LIMIT);

    window.localStorage.setItem(getStorageKey(userId), JSON.stringify(next));
    return true;
  } catch (error) {
    console.warn("로컬 Compass 히스토리를 저장하지 못했습니다.", error);
    return false;
  }
}

export function deleteCompassLocalConversation(userId: string, conversationId: string) {
  if (!userId || !conversationId || !canUseLocalStorage()) return false;

  try {
    const next = loadCompassLocalConversations(userId)
      .filter(item => item.conversation_id !== conversationId && item.id !== conversationId);
    window.localStorage.setItem(getStorageKey(userId), JSON.stringify(next));
    return true;
  } catch (error) {
    console.warn("로컬 Compass 히스토리를 삭제하지 못했습니다.", error);
    return false;
  }
}
