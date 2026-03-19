import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";

export type Message = Anthropic.MessageParam;

export type ConversationRecord = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  messageCount: number;
  cwd: string;
  /** Distinguishes user-initiated conversations from internal non-user sessions. */
  source?: "user" | "action";
};

export type ConversationData = {
  record: ConversationRecord;
  messages: Message[];
  compactionCount: number;
  lastInputTokens: number;
};

export type HistoryIndex = {
  conversations: ConversationRecord[];
};

export const MAX_USER_CONVERSATIONS = 50;
export const MAX_ACTION_CONVERSATIONS = 20;
const TITLE_MAX_LENGTH = 80;

export function getHistoryDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "/tmp";
  return `${home}/.kota/history`;
}

export function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = createHash("sha256")
    .update(`${ts}-${Math.random()}`)
    .digest("hex")
    .slice(0, 6);
  return `${ts}-${rand}`;
}

/** Extract text from a user message's content (string or content block array). */
export function extractText(content: Message["content"]): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textBlock = content.find((b) => "type" in b && b.type === "text");
    if (textBlock && "text" in textBlock) return textBlock.text as string;
  }
  return null;
}

/** Extract a short title from the first user message. */
export function generateTitle(firstMessage: string): string {
  const cleaned = firstMessage
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length <= TITLE_MAX_LENGTH) return cleaned;
  return `${cleaned.slice(0, TITLE_MAX_LENGTH - 3)}...`;
}

/** Count user+assistant messages (excludes tool_result-only turns). */
export function countMessages(messages: Message[]): number {
  return messages.filter((m) => {
    if (m.role === "assistant") return true;
    if (m.role === "user") {
      if (typeof m.content === "string") return true;
      if (Array.isArray(m.content)) {
        return m.content.some((b) => "type" in b && b.type === "text");
      }
    }
    return false;
  }).length;
}
