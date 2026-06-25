import { asArray, asBool, asInt, asNumber, asObject, asString, fail } from './decoder-common';

// MARK: - Per-store semantic search

export type KnowledgeEntry = {
  id: string;
  type: string;
  status: string;
  title: string;
};

export type KnowledgeSearchResponse =
  | { ok: true; entries: KnowledgeEntry[] }
  | { ok: false; reason: "semantic_unavailable" };

export function parseKnowledgeSearchResponse(
  raw: unknown,
): KnowledgeSearchResponse {
  const obj = asObject(raw, "knowledgeSearch");
  const ok = asBool(obj.ok, "knowledgeSearch.ok");
  if (ok) {
    const entries = asArray(obj.entries, "knowledgeSearch.entries").map(
      (entry) => {
        const e = asObject(entry, "knowledgeEntry");
        return {
          id: asString(e.id, "knowledgeEntry.id"),
          type: asString(e.type, "knowledgeEntry.type"),
          status: asString(e.status, "knowledgeEntry.status"),
          title: asString(e.title, "knowledgeEntry.title"),
        };
      },
    );
    return { ok: true, entries };
  }
  const reason = asString(obj.reason, "knowledgeSearch.reason");
  if (reason === "semantic_unavailable") return { ok: false, reason };
  return fail(`unknown knowledge search reason: ${reason}`);
}

export type MemoryEntry = { id: string; created: string; content: string };

export type MemorySearchResponse =
  | { ok: true; entries: MemoryEntry[] }
  | { ok: false; reason: "semantic_unavailable" };

export function parseMemorySearchResponse(
  raw: unknown,
): MemorySearchResponse {
  const obj = asObject(raw, "memorySearch");
  const ok = asBool(obj.ok, "memorySearch.ok");
  if (ok) {
    const entries = asArray(obj.entries, "memorySearch.entries").map(
      (entry) => {
        const e = asObject(entry, "memoryEntry");
        return {
          id: asString(e.id, "memoryEntry.id"),
          created: asString(e.created, "memoryEntry.created"),
          content: asString(e.content, "memoryEntry.content"),
        };
      },
    );
    return { ok: true, entries };
  }
  const reason = asString(obj.reason, "memorySearch.reason");
  if (reason === "semantic_unavailable") return { ok: false, reason };
  return fail(`unknown memory search reason: ${reason}`);
}

export type ConversationRecord = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  messageCount: number;
  cwd: string;
  source?: "user" | "action";
};

export type HistorySearchResponse =
  | { ok: true; conversations: ConversationRecord[] }
  | { ok: false; reason: "semantic_unavailable" };

export function parseHistorySearchResponse(
  raw: unknown,
): HistorySearchResponse {
  const obj = asObject(raw, "historySearch");
  const ok = asBool(obj.ok, "historySearch.ok");
  if (ok) {
    const conversations = asArray(
      obj.conversations,
      "historySearch.conversations",
    ).map((entry) => {
      const c = asObject(entry, "conversationRecord");
      let source: "user" | "action" | undefined;
      if (c.source !== undefined) {
        const s = asString(c.source, "conversationRecord.source");
        if (s !== "user" && s !== "action") {
          fail(`unknown conversation source: ${s}`);
        }
        source = s;
      }
      return {
        id: asString(c.id, "conversationRecord.id"),
        title: asString(c.title, "conversationRecord.title"),
        createdAt: asString(c.createdAt, "conversationRecord.createdAt"),
        updatedAt: asString(c.updatedAt, "conversationRecord.updatedAt"),
        model: asString(c.model, "conversationRecord.model"),
        messageCount: asInt(
          c.messageCount,
          "conversationRecord.messageCount",
        ),
        cwd: asString(c.cwd, "conversationRecord.cwd"),
        source,
      };
    });
    return { ok: true, conversations };
  }
  const reason = asString(obj.reason, "historySearch.reason");
  if (reason === "semantic_unavailable") return { ok: false, reason };
  return fail(`unknown history search reason: ${reason}`);
}

export type RepoTaskSearchHit = {
  id: string;
  title: string;
  state: string;
  priority: string;
  area: string;
  summary: string;
  updatedAt: string;
  score: number;
};

export type TasksSearchResponse =
  | { ok: true; tasks: RepoTaskSearchHit[] }
  | { ok: false; reason: "semantic_unavailable" };

export function parseTasksSearchResponse(raw: unknown): TasksSearchResponse {
  const obj = asObject(raw, "tasksSearch");
  const ok = asBool(obj.ok, "tasksSearch.ok");
  if (ok) {
    const tasks = asArray(obj.tasks, "tasksSearch.tasks").map((entry) => {
      const t = asObject(entry, "repoTaskSearchHit");
      return {
        id: asString(t.id, "repoTaskSearchHit.id"),
        title: asString(t.title, "repoTaskSearchHit.title"),
        state: asString(t.state, "repoTaskSearchHit.state"),
        priority: asString(t.priority, "repoTaskSearchHit.priority"),
        area: asString(t.area, "repoTaskSearchHit.area"),
        summary: asString(t.summary, "repoTaskSearchHit.summary"),
        updatedAt: asString(t.updatedAt, "repoTaskSearchHit.updatedAt"),
        score: asNumber(t.score, "repoTaskSearchHit.score"),
      };
    });
    return { ok: true, tasks };
  }
  const reason = asString(obj.reason, "tasksSearch.reason");
  if (reason === "semantic_unavailable") return { ok: false, reason };
  return fail(`unknown tasks search reason: ${reason}`);
}
