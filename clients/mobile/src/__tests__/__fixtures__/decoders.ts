/**
 * Strict TypeScript decoders for the thin-client contract conformance
 * fixture (`./contract-fixture.json`).
 *
 * Each decoder parses a wire-shaped JSON value through a typed runtime
 * check that mirrors the macOS Swift `Codable` decoders one-to-one:
 * unknown discriminator values (`source`, `target`, `reason`) throw a
 * `ContractDecodeError` instead of silently passing as `unknown`. This
 * keeps the negative-fixture cases (`negative_unknownReason`,
 * `negative_unknownSource`, `negative_unknownTarget`) honest across the
 * web Vitest and mobile Jest decoder suites alongside the macOS Swift
 * conformance suite.
 *
 * The decoders are deliberately scoped to the surfaces named on
 * `task-share-or-conformance-test-daemon-wire-contracts-ac` (recall,
 * answer, answer-history, capture, retract, per-store semantic search,
 * attention, digest, voice failure envelopes) — the cross-client
 * conformance gate, not a runtime parser layer for production callers.
 */

export class ContractDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractDecodeError";
  }
}

function fail(message: string): never {
  throw new ContractDecodeError(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") fail(`expected string at ${field}`);
  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number") fail(`expected number at ${field}`);
  return value;
}

function asInt(value: unknown, field: string): number {
  const n = asNumber(value, field);
  if (!Number.isInteger(n)) fail(`expected integer at ${field}`);
  return n;
}

function asBool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") fail(`expected boolean at ${field}`);
  return value;
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (!isObject(value)) fail(`expected object at ${field}`);
  return value;
}

function asArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) fail(`expected array at ${field}`);
  return value;
}

function asOptionalString(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  return asString(value, field);
}

function asOptionalInt(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  return asInt(value, field);
}

function asOptionalNumber(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;
  return asNumber(value, field);
}

function asOptionalStringArray(
  value: unknown,
  field: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  return asArray(value, field).map((entry, index) =>
    asString(entry, `${field}[${index}]`),
  );
}

// MARK: - Recall

export type RecallSource = "knowledge" | "memory" | "history" | "tasks";

export type RecallKnowledgeHit = {
  source: "knowledge";
  score: number;
  id: string;
  title: string;
  preview: string;
  updated: string;
};

export type RecallMemoryHit = {
  source: "memory";
  score: number;
  id: string;
  preview: string;
  created: string;
};

export type RecallHistoryHit = {
  source: "history";
  score: number;
  id: string;
  title: string;
  cwd: string;
  updatedAt: string;
};

export type RecallTasksHit = {
  source: "tasks";
  score: number;
  id: string;
  title: string;
  state: string;
  priority: string;
  updatedAt: string;
};

export type RecallHit =
  | RecallKnowledgeHit
  | RecallMemoryHit
  | RecallHistoryHit
  | RecallTasksHit;

export type RecallResult =
  | { ok: true; hits: RecallHit[] }
  | { ok: false; reason: "semantic_unavailable" };

export function parseRecallHit(raw: unknown): RecallHit {
  const obj = asObject(raw, "recallHit");
  const source = asString(obj.source, "recallHit.source");
  const score = asNumber(obj.score, "recallHit.score");
  const id = asString(obj.id, "recallHit.id");
  switch (source) {
    case "knowledge":
      return {
        source: "knowledge",
        score,
        id,
        title: asString(obj.title, "recallHit[knowledge].title"),
        preview: asString(obj.preview, "recallHit[knowledge].preview"),
        updated: asString(obj.updated, "recallHit[knowledge].updated"),
      };
    case "memory":
      return {
        source: "memory",
        score,
        id,
        preview: asString(obj.preview, "recallHit[memory].preview"),
        created: asString(obj.created, "recallHit[memory].created"),
      };
    case "history":
      return {
        source: "history",
        score,
        id,
        title: asString(obj.title, "recallHit[history].title"),
        cwd: asString(obj.cwd, "recallHit[history].cwd"),
        updatedAt: asString(obj.updatedAt, "recallHit[history].updatedAt"),
      };
    case "tasks":
      return {
        source: "tasks",
        score,
        id,
        title: asString(obj.title, "recallHit[tasks].title"),
        state: asString(obj.state, "recallHit[tasks].state"),
        priority: asString(obj.priority, "recallHit[tasks].priority"),
        updatedAt: asString(obj.updatedAt, "recallHit[tasks].updatedAt"),
      };
    default:
      return fail(`unknown recall hit source: ${source}`);
  }
}

export function parseRecallResult(raw: unknown): RecallResult {
  const obj = asObject(raw, "recall");
  const ok = asBool(obj.ok, "recall.ok");
  if (ok) {
    const hits = asArray(obj.hits, "recall.hits").map(parseRecallHit);
    return { ok: true, hits };
  }
  const reason = asString(obj.reason, "recall.reason");
  if (reason === "semantic_unavailable") return { ok: false, reason };
  return fail(`unknown recall reason: ${reason}`);
}

// MARK: - Answer

export type AnswerCitation = { source: RecallSource; id: string };

export type AnswerResult =
  | {
      ok: true;
      answer: string;
      citations: AnswerCitation[];
      hits: RecallHit[];
    }
  | {
      ok: false;
      reason: "no_hits" | "semantic_unavailable" | "synthesis_failed";
    };

function parseAnswerCitation(raw: unknown): AnswerCitation {
  const obj = asObject(raw, "answerCitation");
  const source = asString(obj.source, "answerCitation.source");
  if (
    source !== "knowledge" &&
    source !== "memory" &&
    source !== "history" &&
    source !== "tasks"
  ) {
    return fail(`unknown answer citation source: ${source}`);
  }
  return { source, id: asString(obj.id, "answerCitation.id") };
}

export function parseAnswerResult(raw: unknown): AnswerResult {
  const obj = asObject(raw, "answer");
  const ok = asBool(obj.ok, "answer.ok");
  if (ok) {
    return {
      ok: true,
      answer: asString(obj.answer, "answer.answer"),
      citations: asArray(obj.citations, "answer.citations").map(
        parseAnswerCitation,
      ),
      hits: asArray(obj.hits, "answer.hits").map(parseRecallHit),
    };
  }
  const reason = asString(obj.reason, "answer.reason");
  if (
    reason === "no_hits" ||
    reason === "semantic_unavailable" ||
    reason === "synthesis_failed"
  ) {
    return { ok: false, reason };
  }
  return fail(`unknown answer reason: ${reason}`);
}

// MARK: - Answer history

export type AnswerHistoryEntryResult =
  | { ok: true; citationCount: number }
  | { ok: false; reason: "no_hits" | "semantic_unavailable" | "synthesis_failed" };

export type AnswerHistoryEntry = {
  id: string;
  createdAt: string;
  query: string;
  result: AnswerHistoryEntryResult;
};

function parseAnswerHistoryEntryResult(raw: unknown): AnswerHistoryEntryResult {
  const obj = asObject(raw, "answerHistoryEntry.result");
  const ok = asBool(obj.ok, "answerHistoryEntry.result.ok");
  if (ok) {
    return {
      ok: true,
      citationCount: asInt(
        obj.citationCount,
        "answerHistoryEntry.result.citationCount",
      ),
    };
  }
  const reason = asString(obj.reason, "answerHistoryEntry.result.reason");
  if (
    reason === "no_hits" ||
    reason === "semantic_unavailable" ||
    reason === "synthesis_failed"
  ) {
    return { ok: false, reason };
  }
  return fail(`unknown answer history entry reason: ${reason}`);
}

export type AnswerHistoryListResult = { entries: AnswerHistoryEntry[] };

export function parseAnswerHistoryListResult(
  raw: unknown,
): AnswerHistoryListResult {
  const obj = asObject(raw, "answerHistoryList");
  return {
    entries: asArray(obj.entries, "answerHistoryList.entries").map((entry) => {
      const e = asObject(entry, "answerHistoryEntry");
      return {
        id: asString(e.id, "answerHistoryEntry.id"),
        createdAt: asString(e.createdAt, "answerHistoryEntry.createdAt"),
        query: asString(e.query, "answerHistoryEntry.query"),
        result: parseAnswerHistoryEntryResult(e.result),
      };
    }),
  };
}

export type AnswerHistoryRecord = {
  id: string;
  createdAt: string;
  query: string;
  filter: {
    topK?: number;
    minScore?: number;
    sources?: string[];
  };
  recallHits: RecallHit[];
  result: AnswerResult;
};

export type AnswerHistoryShowResult =
  | { ok: true; record: AnswerHistoryRecord }
  | { ok: false; reason: "not_found" };

export function parseAnswerHistoryShowResult(
  raw: unknown,
): AnswerHistoryShowResult {
  const obj = asObject(raw, "answerHistoryShow");
  const ok = asBool(obj.ok, "answerHistoryShow.ok");
  if (ok) {
    const record = asObject(obj.record, "answerHistoryShow.record");
    const filter = asObject(record.filter, "answerHistoryShow.record.filter");
    return {
      ok: true,
      record: {
        id: asString(record.id, "record.id"),
        createdAt: asString(record.createdAt, "record.createdAt"),
        query: asString(record.query, "record.query"),
        filter: {
          topK: asOptionalInt(filter.topK, "filter.topK"),
          minScore: asOptionalNumber(filter.minScore, "filter.minScore"),
          sources: asOptionalStringArray(filter.sources, "filter.sources"),
        },
        recallHits: asArray(record.recallHits, "record.recallHits").map(
          parseRecallHit,
        ),
        result: parseAnswerResult(record.result),
      },
    };
  }
  const reason = asString(obj.reason, "answerHistoryShow.reason");
  if (reason === "not_found") return { ok: false, reason };
  return fail(`unknown answer history show reason: ${reason}`);
}

// MARK: - Capture

export type CaptureTarget = "memory" | "knowledge" | "tasks" | "inbox";

export type CaptureRecord =
  | { target: "memory"; recordId: string }
  | { target: "knowledge"; recordId: string }
  | { target: "tasks"; recordId: string; path: string }
  | { target: "inbox"; recordId: string; path: string };

function parseCaptureTarget(raw: unknown, field: string): CaptureTarget {
  const value = asString(raw, field);
  if (
    value === "memory" ||
    value === "knowledge" ||
    value === "tasks" ||
    value === "inbox"
  ) {
    return value;
  }
  return fail(`unknown capture target: ${value}`);
}

function parseCaptureRecord(raw: unknown): CaptureRecord {
  const obj = asObject(raw, "captureRecord");
  const target = parseCaptureTarget(obj.target, "captureRecord.target");
  const recordId = asString(obj.recordId, "captureRecord.recordId");
  switch (target) {
    case "memory":
    case "knowledge":
      return { target, recordId };
    case "tasks":
    case "inbox":
      return {
        target,
        recordId,
        path: asString(obj.path, `captureRecord[${target}].path`),
      };
  }
}

export type CaptureResult =
  | { ok: true; record: CaptureRecord }
  | { ok: false; reason: "ambiguous"; suggestions: CaptureTarget[] }
  | { ok: false; reason: "no_contributors" }
  | {
      ok: false;
      reason: "contributor_failed";
      target: CaptureTarget;
      message: string;
    };

export function parseCaptureResult(raw: unknown): CaptureResult {
  const obj = asObject(raw, "capture");
  const ok = asBool(obj.ok, "capture.ok");
  if (ok) {
    return { ok: true, record: parseCaptureRecord(obj.record) };
  }
  const reason = asString(obj.reason, "capture.reason");
  switch (reason) {
    case "ambiguous": {
      const suggestions = asArray(obj.suggestions, "capture.suggestions").map(
        (entry, index) =>
          parseCaptureTarget(entry, `capture.suggestions[${index}]`),
      );
      return { ok: false, reason, suggestions };
    }
    case "no_contributors":
      return { ok: false, reason };
    case "contributor_failed":
      return {
        ok: false,
        reason,
        target: parseCaptureTarget(obj.target, "capture.target"),
        message: asString(obj.message, "capture.message"),
      };
    default:
      return fail(`unknown capture reason: ${reason}`);
  }
}

// MARK: - Retract

export type RetractTarget = "memory" | "knowledge" | "tasks" | "inbox";

export type RetractRecord =
  | { target: "memory"; recordId: string }
  | { target: "knowledge"; recordId: string }
  | {
      target: "tasks";
      recordId: string;
      previousPath: string;
      path: string;
      toState: "dropped";
    }
  | { target: "inbox"; recordId: string; path: string };

function parseRetractTarget(raw: unknown, field: string): RetractTarget {
  const value = asString(raw, field);
  if (
    value === "memory" ||
    value === "knowledge" ||
    value === "tasks" ||
    value === "inbox"
  ) {
    return value;
  }
  return fail(`unknown retract target: ${value}`);
}

function parseRetractRecord(raw: unknown): RetractRecord {
  const obj = asObject(raw, "retractRecord");
  const target = parseRetractTarget(obj.target, "retractRecord.target");
  const recordId = asString(obj.recordId, "retractRecord.recordId");
  switch (target) {
    case "memory":
    case "knowledge":
      return { target, recordId };
    case "tasks": {
      const toState = asString(obj.toState, "retractRecord[tasks].toState");
      if (toState !== "dropped") {
        return fail(`unknown retract task toState: ${toState}`);
      }
      return {
        target,
        recordId,
        previousPath: asString(
          obj.previousPath,
          "retractRecord[tasks].previousPath",
        ),
        path: asString(obj.path, "retractRecord[tasks].path"),
        toState,
      };
    }
    case "inbox":
      return {
        target,
        recordId,
        path: asString(obj.path, "retractRecord[inbox].path"),
      };
  }
}

export type RetractResult =
  | { ok: true; record: RetractRecord }
  | { ok: false; reason: "no_contributors" }
  | {
      ok: false;
      reason: "not_found";
      target: RetractTarget;
      identifier: string;
    }
  | {
      ok: false;
      reason: "contributor_failed";
      target: RetractTarget;
      message: string;
    };

export function parseRetractResult(raw: unknown): RetractResult {
  const obj = asObject(raw, "retract");
  const ok = asBool(obj.ok, "retract.ok");
  if (ok) {
    return { ok: true, record: parseRetractRecord(obj.record) };
  }
  const reason = asString(obj.reason, "retract.reason");
  switch (reason) {
    case "no_contributors":
      return { ok: false, reason };
    case "not_found":
      return {
        ok: false,
        reason,
        target: parseRetractTarget(obj.target, "retract.target"),
        identifier: asString(obj.identifier, "retract.identifier"),
      };
    case "contributor_failed":
      return {
        ok: false,
        reason,
        target: parseRetractTarget(obj.target, "retract.target"),
        message: asString(obj.message, "retract.message"),
      };
    default:
      return fail(`unknown retract reason: ${reason}`);
  }
}

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

// MARK: - Attention

export type AttentionItem = { label: string; detail: string };

export type AttentionResponse = {
  data: { items: AttentionItem[] };
  text: string;
};

export function parseAttentionResponse(raw: unknown): AttentionResponse {
  const obj = asObject(raw, "attention");
  const data = asObject(obj.data, "attention.data");
  const items = asArray(data.items, "attention.data.items").map((entry) => {
    const e = asObject(entry, "attentionItem");
    return {
      label: asString(e.label, "attentionItem.label"),
      detail: asString(e.detail, "attentionItem.detail"),
    };
  });
  return {
    data: { items },
    text: asString(obj.text, "attention.text"),
  };
}

// MARK: - Digest

export type DigestQueueCounts = {
  backlog: number;
  ready: number;
  doing: number;
  blocked: number;
};

export type DigestQueueDelta = {
  current: DigestQueueCounts;
  previous: DigestQueueCounts | null;
  delta: { backlog: number | null; ready: number | null; doing: number | null; blocked: number | null };
};

function parseDigestQueueCounts(raw: unknown, field: string): DigestQueueCounts {
  const o = asObject(raw, field);
  return {
    backlog: asInt(o.backlog, `${field}.backlog`),
    ready: asInt(o.ready, `${field}.ready`),
    doing: asInt(o.doing, `${field}.doing`),
    blocked: asInt(o.blocked, `${field}.blocked`),
  };
}

function parseDigestQueueDelta(raw: unknown): DigestQueueDelta {
  const o = asObject(raw, "digest.data.queueDelta");
  const current = parseDigestQueueCounts(o.current, "queueDelta.current");
  const previousRaw = o.previous;
  const previous = previousRaw === null
    ? null
    : parseDigestQueueCounts(previousRaw, "queueDelta.previous");
  const deltaObj = asObject(o.delta, "queueDelta.delta");
  const readField = (key: keyof DigestQueueCounts): number | null => {
    const v = deltaObj[key];
    if (v === null) return null;
    return asInt(v, `queueDelta.delta.${key}`);
  };
  return {
    current,
    previous,
    delta: {
      backlog: readField("backlog"),
      ready: readField("ready"),
      doing: readField("doing"),
      blocked: readField("blocked"),
    },
  };
}

export type DigestData = {
  windowStartedAt: string;
  windowEndedAt: string;
  builderCommits: Array<{
    runId: string;
    taskId: string | null;
    taskTitle: string | null;
    commitSubject: string;
    durationMs: number | null;
  }>;
  explorerAdditions: Array<{
    runId: string;
    taskCount: number;
    watchlistAdds: number;
  }>;
  decomposerSplits: Array<{
    runId: string;
    parentTaskId: string | null;
    childTaskCount: number;
  }>;
  blockedPromoterMoves: Array<{
    runId: string;
    promotedTaskIds: string[];
    toReady: string[];
    toBacklog: string[];
  }>;
  failedMonitoredRuns: Array<{
    runId: string;
    workflow: string;
    status: "failed" | "interrupted";
    startedAt: string;
  }>;
  pendingOwnerQuestions: Array<{
    id: string;
    question: string;
    source: string;
    ageDays: number;
  }>;
  agingOperatorCaptures: Array<{
    taskId: string;
    ageDays: number;
    path: string;
  }>;
  queueDelta: DigestQueueDelta;
  quiet: boolean;
};

export type DigestResponse = { data: DigestData; text: string };

export function parseDigestResponse(raw: unknown): DigestResponse {
  const top = asObject(raw, "digest");
  const data = asObject(top.data, "digest.data");
  const builderCommits = asArray(
    data.builderCommits,
    "digest.data.builderCommits",
  ).map((entry) => {
    const e = asObject(entry, "builderCommit");
    return {
      runId: asString(e.runId, "builderCommit.runId"),
      taskId: e.taskId === null ? null : asString(e.taskId, "builderCommit.taskId"),
      taskTitle:
        e.taskTitle === null ? null : asString(e.taskTitle, "builderCommit.taskTitle"),
      commitSubject: asString(e.commitSubject, "builderCommit.commitSubject"),
      durationMs:
        e.durationMs === null
          ? null
          : asInt(e.durationMs, "builderCommit.durationMs"),
    };
  });
  const explorerAdditions = asArray(
    data.explorerAdditions,
    "digest.data.explorerAdditions",
  ).map((entry) => {
    const e = asObject(entry, "explorerAddition");
    return {
      runId: asString(e.runId, "explorerAddition.runId"),
      taskCount: asInt(e.taskCount, "explorerAddition.taskCount"),
      watchlistAdds: asInt(e.watchlistAdds, "explorerAddition.watchlistAdds"),
    };
  });
  const decomposerSplits = asArray(
    data.decomposerSplits,
    "digest.data.decomposerSplits",
  ).map((entry) => {
    const e = asObject(entry, "decomposerSplit");
    return {
      runId: asString(e.runId, "decomposerSplit.runId"),
      parentTaskId:
        e.parentTaskId === null
          ? null
          : asString(e.parentTaskId, "decomposerSplit.parentTaskId"),
      childTaskCount: asInt(
        e.childTaskCount,
        "decomposerSplit.childTaskCount",
      ),
    };
  });
  const blockedPromoterMoves = asArray(
    data.blockedPromoterMoves,
    "digest.data.blockedPromoterMoves",
  ).map((entry) => {
    const e = asObject(entry, "blockedPromoterMove");
    return {
      runId: asString(e.runId, "blockedPromoterMove.runId"),
      promotedTaskIds: asArray(
        e.promotedTaskIds,
        "blockedPromoterMove.promotedTaskIds",
      ).map((s, i) =>
        asString(s, `blockedPromoterMove.promotedTaskIds[${i}]`),
      ),
      toReady: asArray(e.toReady, "blockedPromoterMove.toReady").map((s, i) =>
        asString(s, `blockedPromoterMove.toReady[${i}]`),
      ),
      toBacklog: asArray(
        e.toBacklog,
        "blockedPromoterMove.toBacklog",
      ).map((s, i) => asString(s, `blockedPromoterMove.toBacklog[${i}]`)),
    };
  });
  const failedMonitoredRuns = asArray(
    data.failedMonitoredRuns,
    "digest.data.failedMonitoredRuns",
  ).map((entry): {
    runId: string;
    workflow: string;
    status: "failed" | "interrupted";
    startedAt: string;
  } => {
    const e = asObject(entry, "failedMonitoredRun");
    const status = asString(e.status, "failedMonitoredRun.status");
    if (status !== "failed" && status !== "interrupted") {
      return fail(`unknown failed-run status: ${status}`);
    }
    return {
      runId: asString(e.runId, "failedMonitoredRun.runId"),
      workflow: asString(e.workflow, "failedMonitoredRun.workflow"),
      status,
      startedAt: asString(e.startedAt, "failedMonitoredRun.startedAt"),
    };
  });
  const pendingOwnerQuestions = asArray(
    data.pendingOwnerQuestions,
    "digest.data.pendingOwnerQuestions",
  ).map((entry) => {
    const e = asObject(entry, "pendingOwnerQuestion");
    return {
      id: asString(e.id, "pendingOwnerQuestion.id"),
      question: asString(e.question, "pendingOwnerQuestion.question"),
      source: asString(e.source, "pendingOwnerQuestion.source"),
      ageDays: asInt(e.ageDays, "pendingOwnerQuestion.ageDays"),
    };
  });
  const agingOperatorCaptures = asArray(
    data.agingOperatorCaptures,
    "digest.data.agingOperatorCaptures",
  ).map((entry) => {
    const e = asObject(entry, "agingOperatorCapture");
    return {
      taskId: asString(e.taskId, "agingOperatorCapture.taskId"),
      ageDays: asInt(e.ageDays, "agingOperatorCapture.ageDays"),
      path: asString(e.path, "agingOperatorCapture.path"),
    };
  });
  return {
    data: {
      windowStartedAt: asString(
        data.windowStartedAt,
        "digest.data.windowStartedAt",
      ),
      windowEndedAt: asString(data.windowEndedAt, "digest.data.windowEndedAt"),
      builderCommits,
      explorerAdditions,
      decomposerSplits,
      blockedPromoterMoves,
      failedMonitoredRuns,
      pendingOwnerQuestions,
      agingOperatorCaptures,
      queueDelta: parseDigestQueueDelta(data.queueDelta),
      quiet: asBool(data.quiet, "digest.data.quiet"),
    },
    text: asString(top.text, "digest.text"),
  };
}

// MARK: - Voice failure envelopes
//
// The voice success surfaces (`POST /voice/transcribe` with audio attached;
// the synthesize route returning audio bytes) carry binary payloads outside
// the JSON contract — only the failure envelopes are exercised here.

export type VoiceFailure = {
  ok: false;
  status: number;
  error: string;
  code: string;
  supported?: string[];
};

export type VoiceTranscribeSuccess = {
  ok: true;
  text: string;
  language?: string;
};

export type VoiceTranscribeResult = VoiceTranscribeSuccess | VoiceFailure;

export function parseVoiceTranscribeResult(raw: unknown): VoiceTranscribeResult {
  const obj = asObject(raw, "voice");
  const ok = asBool(obj.ok, "voice.ok");
  if (ok) {
    return {
      ok: true,
      text: asString(obj.text, "voice.text"),
      language: asOptionalString(obj.language, "voice.language"),
    };
  }
  return parseVoiceFailure(obj);
}

export function parseVoiceFailure(obj: Record<string, unknown>): VoiceFailure {
  const code = asString(obj.code, "voice.code");
  const KNOWN = new Set([
    "stt-unavailable",
    "stt-failed",
    "tts-unavailable",
    "tts-failed",
    "tts-format-unsupported",
  ]);
  if (!KNOWN.has(code)) {
    return fail(`unknown voice failure code: ${code}`);
  }
  return {
    ok: false,
    status: asInt(obj.status, "voice.status"),
    error: asString(obj.error, "voice.error"),
    code,
    supported: asOptionalStringArray(obj.supported, "voice.supported"),
  };
}
