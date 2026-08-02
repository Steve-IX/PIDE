import type { ChatMessage } from "../types";

export interface ChatSession {
  id: string;
  title: string;
  model: string;
  messages: ChatMessage[];
  updatedAt: number;
}

function key(workspacePath: string) {
  return `pide.chat.sessions.v1:${workspacePath}`;
}

export function loadSessions(workspacePath: string): ChatSession[] {
  if (!workspacePath) return [];
  try {
    const raw = localStorage.getItem(key(workspacePath));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSessions(workspacePath: string, sessions: ChatSession[]) {
  if (!workspacePath) return;
  localStorage.setItem(key(workspacePath), JSON.stringify(sessions.slice(0, 40)));
}

export function newSession(model = ""): ChatSession {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: "New chat",
    model,
    messages: [],
    updatedAt: Date.now(),
  };
}

export function titleFromMessages(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "New chat";
  const t = first.content.replace(/\s+/g, " ").trim();
  return t.length > 48 ? `${t.slice(0, 48)}…` : t || "New chat";
}
