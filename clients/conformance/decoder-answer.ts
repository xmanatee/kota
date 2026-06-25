import { asArray, asBool, asInt, asObject, asOptionalInt, asOptionalNumber, asOptionalStringArray, asString, fail } from './decoder-common';
import { parseRecallHit, type RecallHit, type RecallSource } from './decoder-recall';

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
    source !== "tasks" &&
    source !== "answer"
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
