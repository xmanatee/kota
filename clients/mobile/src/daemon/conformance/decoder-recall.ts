import {
  asArray,
  asBool,
  asInt,
  asNumber,
  asObject,
  asOptionalString,
  asString,
  fail,
} from './decoder-common';
import {
  parseOptionalWorkMemoryFreshness,
  parseOptionalWorkMemoryProvenance,
  type WorkMemoryFreshness,
  type WorkMemoryProvenance,
} from './decoder-work-memory';

// MARK: - Recall

export type RecallSource =
  | "knowledge"
  | "memory"
  | "history"
  | "tasks"
  | "answer";

export type RecallKnowledgeHit = {
  source: "knowledge";
  score: number;
  id: string;
  title: string;
  preview: string;
  updated: string;
  provenance?: WorkMemoryProvenance;
  freshness?: WorkMemoryFreshness;
};

export type RecallMemoryHit = {
  source: "memory";
  score: number;
  id: string;
  preview: string;
  created: string;
  updated?: string;
  provenance?: WorkMemoryProvenance;
  freshness?: WorkMemoryFreshness;
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

export type RecallAnswerHitResult =
  | { ok: true }
  | {
      ok: false;
      reason: "no_hits" | "semantic_unavailable" | "synthesis_failed";
    };

export type RecallAnswerHit = {
  source: "answer";
  score: number;
  id: string;
  query: string;
  preview: string;
  citationCount: number;
  createdAt: string;
  result: RecallAnswerHitResult;
};

export type RecallHit =
  | RecallKnowledgeHit
  | RecallMemoryHit
  | RecallHistoryHit
  | RecallTasksHit
  | RecallAnswerHit;

export type RecallResult =
  | { ok: true; hits: RecallHit[] }
  | { ok: false; reason: "semantic_unavailable" };

function parseRecallAnswerHitResult(raw: unknown): RecallAnswerHitResult {
  const obj = asObject(raw, "recallHit[answer].result");
  const ok = asBool(obj.ok, "recallHit[answer].result.ok");
  if (ok) return { ok: true };
  const reason = asString(obj.reason, "recallHit[answer].result.reason");
  if (
    reason === "no_hits" ||
    reason === "semantic_unavailable" ||
    reason === "synthesis_failed"
  ) {
    return { ok: false, reason };
  }
  return fail(`unknown recall answer-hit result reason: ${reason}`);
}
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
        ...optionalRecallMetadata(obj, "recallHit[knowledge]"),
      };
    case "memory":
      return {
        source: "memory",
        score,
        id,
        preview: asString(obj.preview, "recallHit[memory].preview"),
        created: asString(obj.created, "recallHit[memory].created"),
        ...(asOptionalString(obj.updated, "recallHit[memory].updated") !==
          undefined && {
          updated: asOptionalString(obj.updated, "recallHit[memory].updated"),
        }),
        ...optionalRecallMetadata(obj, "recallHit[memory]"),
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
    case "answer":
      return {
        source: "answer",
        score,
        id,
        query: asString(obj.query, "recallHit[answer].query"),
        preview: asString(obj.preview, "recallHit[answer].preview"),
        citationCount: asInt(
          obj.citationCount,
          "recallHit[answer].citationCount",
        ),
        createdAt: asString(obj.createdAt, "recallHit[answer].createdAt"),
        result: parseRecallAnswerHitResult(obj.result),
      };
    default:
      return fail(`unknown recall hit source: ${source}`);
  }
}

function optionalRecallMetadata(
  obj: Record<string, unknown>,
  field: string,
): {
  provenance?: WorkMemoryProvenance;
  freshness?: WorkMemoryFreshness;
} {
  const provenance = parseOptionalWorkMemoryProvenance(
    obj.provenance,
    `${field}.provenance`,
  );
  const freshness = parseOptionalWorkMemoryFreshness(
    obj.freshness,
    `${field}.freshness`,
  );
  return {
    ...(provenance && { provenance }),
    ...(freshness && { freshness }),
  };
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
