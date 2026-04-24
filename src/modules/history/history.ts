import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ConversationData,
  type ConversationRecord,
  countMessages,
  extractText,
  generateId,
  generateTitle,
  getHistoryDir,
  type HistoryIndex,
  MAX_ACTION_CONVERSATIONS,
  MAX_USER_CONVERSATIONS,
  type Message,
} from "./history-utils.js";

export type { ConversationData, ConversationRecord } from "#core/modules/provider-types.js";
export { generateTitle } from "./history-utils.js";

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export class ConversationHistory {
  private dir: string;
  private indexPath: string;

  constructor(dir?: string) {
    this.dir = dir || getHistoryDir();
    this.indexPath = join(this.dir, "index.json");
    ensureDir(this.dir);
  }

  /** Create a new conversation and return its ID. */
  create(model: string, cwd: string, source?: "user" | "action"): string {
    const id = generateId();
    const now = new Date().toISOString();
    const record: ConversationRecord = {
      id,
      title: "(new conversation)",
      createdAt: now,
      updatedAt: now,
      model,
      messageCount: 0,
      cwd,
      source: source ?? "user",
    };

    const data: ConversationData = {
      record,
      messages: [],
      compactionCount: 0,
      lastInputTokens: 0,
    };
    this.writeConversation(id, data);

    const index = this.loadIndex();
    index.conversations.unshift(record);
    this.pruneAndSave(index);

    return id;
  }

  /** Save conversation state. Updates title from first user message if needed. */
  save(
    id: string,
    messages: Message[],
    compactionCount: number,
    lastInputTokens: number,
  ): void {
    const index = this.loadIndex();
    const entry = index.conversations.find((c) => c.id === id);
    if (!entry) return;

    if (entry.title === "(new conversation)" && messages.length > 0) {
      const firstUser = messages.find((m) => m.role === "user");
      if (firstUser) {
        const text = extractText(firstUser.content);
        if (text) entry.title = generateTitle(text);
      }
    }

    entry.updatedAt = new Date().toISOString();
    entry.messageCount = countMessages(messages);

    const data: ConversationData = {
      record: entry,
      messages,
      compactionCount,
      lastInputTokens,
    };
    this.writeConversation(id, data);
    this.saveIndex(index);
  }

  /** Load conversation data for resuming. */
  load(id: string): ConversationData | null {
    const path = join(this.dir, `${id}.json`);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      return null;
    }
  }

  /** List conversations, optionally filtered by search term and source. */
  list(opts?: { search?: string; limit?: number; cwd?: string; source?: "user" | "action" }): ConversationRecord[] {
    const index = this.loadIndex();
    let results = index.conversations;

    if (opts?.source) {
      results = results.filter((c) => (c.source ?? "user") === opts.source);
    }

    if (opts?.cwd) {
      results = results.filter((c) => c.cwd === opts.cwd);
    }

    if (opts?.search) {
      const q = opts.search.toLowerCase();
      results = results.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.cwd.toLowerCase().includes(q),
      );
    }

    const limit = opts?.limit ?? 20;
    return results.slice(0, limit);
  }

  /** Get the most recent conversation for a given cwd. */
  getMostRecent(cwd?: string): ConversationRecord | null {
    const results = this.list({ cwd, limit: 1 });
    return results[0] || null;
  }

  /** Find a conversation by exact ID or unique prefix. Returns null if not found, throws if ambiguous. */
  findByPrefix(idOrPrefix: string): ConversationRecord | null {
    const trimmed = idOrPrefix.trim();
    if (!trimmed) return null;

    const index = this.loadIndex();

    // Exact match first
    const exact = index.conversations.find((c) => c.id === trimmed);
    if (exact) return exact;

    // Prefix match
    const matches = index.conversations.filter((c) => c.id.startsWith(trimmed));
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];

    throw new Error(
      `Ambiguous ID prefix "${trimmed}" matches ${matches.length} conversations: ${matches.map((c) => c.id).join(", ")}`,
    );
  }

  /** Remove a conversation. */
  remove(id: string): boolean {
    const index = this.loadIndex();
    const idx = index.conversations.findIndex((c) => c.id === id);
    if (idx === -1) return false;

    index.conversations.splice(idx, 1);
    this.saveIndex(index);

    const path = join(this.dir, `${id}.json`);
    if (existsSync(path)) unlinkSync(path);
    return true;
  }

  private loadIndex(): HistoryIndex {
    if (!existsSync(this.indexPath)) return { conversations: [] };
    try {
      return JSON.parse(readFileSync(this.indexPath, "utf-8"));
    } catch {
      return { conversations: [] };
    }
  }

  private saveIndex(index: HistoryIndex): void {
    writeFileSync(this.indexPath, JSON.stringify(index, null, 2), "utf-8");
  }

  private writeConversation(id: string, data: ConversationData): void {
    const path = join(this.dir, `${id}.json`);
    writeFileSync(path, JSON.stringify(data), "utf-8");
  }

  /** Remove oldest conversations beyond per-source limits. */
  private pruneAndSave(index: HistoryIndex): void {
    let userCount = 0;
    let actionCount = 0;
    const keep: ConversationRecord[] = [];
    const removeIds: string[] = [];

    for (const c of index.conversations) {
      const src = c.source ?? "user";
      const limit = src === "action" ? MAX_ACTION_CONVERSATIONS : MAX_USER_CONVERSATIONS;
      const count = src === "action" ? actionCount : userCount;

      if (count < limit) {
        keep.push(c);
        if (src === "action") actionCount++;
        else userCount++;
      } else {
        removeIds.push(c.id);
      }
    }

    for (const id of removeIds) {
      const path = join(this.dir, `${id}.json`);
      if (existsSync(path)) unlinkSync(path);
    }

    index.conversations = keep;
    this.saveIndex(index);
  }

  /** Clean up orphaned files not in the index. */
  cleanup(): number {
    const index = this.loadIndex();
    const knownIds = new Set(index.conversations.map((c) => c.id));
    let cleaned = 0;

    try {
      const files = readdirSync(this.dir);
      for (const f of files) {
        if (f === "index.json") continue;
        if (!f.endsWith(".json")) continue;
        const id = f.replace(".json", "");
        if (!knownIds.has(id)) {
          try {
            unlinkSync(join(this.dir, f));
            cleaned++;
          } catch (err) {
            console.warn(`[kota-history] Failed to remove orphaned conversation file ${f}:`, err instanceof Error ? err.message : String(err));
          }
        }
      }
    } catch (err) {
      console.warn("[kota-history] Failed to scan history directory for orphaned files:", err instanceof Error ? err.message : String(err));
    }

    return cleaned;
  }
}

let globalHistory: ConversationHistory | null = null;

export function getHistory(): ConversationHistory {
  if (!globalHistory) globalHistory = new ConversationHistory();
  return globalHistory;
}

export function resetHistory(): void {
  globalHistory = null;
}
