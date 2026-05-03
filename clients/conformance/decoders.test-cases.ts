/**
 * Test-runner-agnostic case definitions for the cross-client conformance
 * decoders. Each case names a top-level fixture path, the decoder under
 * test, and an `expectThrow` flag for the negative cases.
 *
 * Web (Vitest) and mobile (Jest) both consume this list so each surface
 * is exercised in lockstep across both clients without duplicating the
 * case enumeration in three places.
 */

import {
  parseAnswerHistoryListResult,
  parseAnswerHistoryShowResult,
  parseAnswerResult,
  parseAttentionResponse,
  parseCaptureResult,
  parseDigestResponse,
  parseHistorySearchResponse,
  parseKnowledgeSearchResponse,
  parseMemorySearchResponse,
  parseRecallResult,
  parseRetractResult,
  parseTasksSearchResponse,
  parseVoiceFailure,
  parseVoiceTranscribeResult,
} from "./decoders";

export type ConformanceCase = {
  name: string;
  /** Dot-separated path into the canonical fixture object. */
  path: string;
  /** Decoder under test; receives the resolved subtree. */
  parse: (raw: unknown) => unknown;
  /** When true, the case verifies the decoder rejects unknown discriminators. */
  expectThrow?: true;
  /** Optional positive-arm assertion run after decoding. */
  assertPositive?: (decoded: unknown) => void;
};

export const CONFORMANCE_CASES: ConformanceCase[] = [
  // recall
  {
    name: "recall: success across knowledge/memory/history/tasks/answer sources",
    path: "recall.successMixedSources",
    parse: parseRecallResult,
    assertPositive: (decoded) => {
      const r = decoded as { ok: true; hits: Array<{ source: string }> };
      if (!r.ok || r.hits.length !== 5) {
        throw new Error("expected 5-hit ok result");
      }
      if (!r.hits.some((h) => h.source === "answer")) {
        throw new Error(
          "expected the mixed-source arm to include a source: 'answer' hit",
        );
      }
    },
  },
  {
    name: "recall: success with answer hit carrying failure arm",
    path: "recall.successAnswerHitFailureArm",
    parse: parseRecallResult,
    assertPositive: (decoded) => {
      const r = decoded as {
        ok: true;
        hits: Array<{ source: string; result?: { ok: boolean } }>;
      };
      if (!r.ok || r.hits.length !== 1 || r.hits[0]!.source !== "answer") {
        throw new Error("expected single answer-hit result");
      }
      if (r.hits[0]!.result?.ok !== false) {
        throw new Error("expected nested answer-hit result to be ok=false");
      }
    },
  },
  {
    name: "recall: semantic_unavailable failure arm",
    path: "recall.semanticUnavailable",
    parse: parseRecallResult,
  },
  {
    name: "recall: unknown source rejected",
    path: "recall.negative_unknownSource",
    parse: parseRecallResult,
    expectThrow: true,
  },
  {
    name: "recall: unknown nested answer-hit result reason rejected",
    path: "recall.negative_unknownAnswerResultReason",
    parse: parseRecallResult,
    expectThrow: true,
  },
  {
    name: "recall: unknown reason rejected",
    path: "recall.negative_unknownReason",
    parse: parseRecallResult,
    expectThrow: true,
  },

  // answer
  {
    name: "answer: success with citations across knowledge/memory/answer sources",
    path: "answer.success",
    parse: parseAnswerResult,
    assertPositive: (decoded) => {
      const r = decoded as {
        ok: true;
        citations: Array<{ source: string; id: string }>;
        hits: Array<{ source: string }>;
      };
      if (!r.ok || r.citations.length === 0) throw new Error("expected citations");
      if (!r.citations.some((c) => c.source === "answer")) {
        throw new Error(
          "expected the success arm to include a source: 'answer' citation",
        );
      }
      if (!r.hits.some((h) => h.source === "answer")) {
        throw new Error(
          "expected the success arm to include a matching source: 'answer' hit",
        );
      }
    },
  },
  {
    name: "answer: no_hits arm",
    path: "answer.noHits",
    parse: parseAnswerResult,
  },
  {
    name: "answer: semantic_unavailable arm",
    path: "answer.semanticUnavailable",
    parse: parseAnswerResult,
  },
  {
    name: "answer: synthesis_failed arm",
    path: "answer.synthesisFailed",
    parse: parseAnswerResult,
  },
  {
    name: "answer: unknown reason rejected",
    path: "answer.negative_unknownReason",
    parse: parseAnswerResult,
    expectThrow: true,
  },
  {
    name: "answer: unknown citation source rejected",
    path: "answer.negative_unknownCitationSource",
    parse: parseAnswerResult,
    expectThrow: true,
  },

  // answerHistory
  {
    name: "answerHistory: list with mixed ok/no_hits results",
    path: "answerHistory.list",
    parse: parseAnswerHistoryListResult,
    assertPositive: (decoded) => {
      const r = decoded as { entries: Array<unknown> };
      if (r.entries.length !== 2) throw new Error("expected 2 entries");
    },
  },
  {
    name: "answerHistory: show=found",
    path: "answerHistory.showFound",
    parse: parseAnswerHistoryShowResult,
  },
  {
    name: "answerHistory: show=not_found",
    path: "answerHistory.showNotFound",
    parse: parseAnswerHistoryShowResult,
  },
  {
    name: "answerHistory: unknown show reason rejected",
    path: "answerHistory.negative_unknownReason",
    parse: parseAnswerHistoryShowResult,
    expectThrow: true,
  },

  // capture
  {
    name: "capture: success memory",
    path: "capture.successMemory",
    parse: parseCaptureResult,
  },
  {
    name: "capture: success knowledge",
    path: "capture.successKnowledge",
    parse: parseCaptureResult,
  },
  {
    name: "capture: success tasks",
    path: "capture.successTasks",
    parse: parseCaptureResult,
  },
  {
    name: "capture: success inbox",
    path: "capture.successInbox",
    parse: parseCaptureResult,
  },
  {
    name: "capture: ambiguous arm with suggestions",
    path: "capture.ambiguous",
    parse: parseCaptureResult,
  },
  {
    name: "capture: no_contributors arm",
    path: "capture.noContributors",
    parse: parseCaptureResult,
  },
  {
    name: "capture: contributor_failed arm",
    path: "capture.contributorFailed",
    parse: parseCaptureResult,
  },
  {
    name: "capture: unknown target rejected",
    path: "capture.negative_unknownTarget",
    parse: parseCaptureResult,
    expectThrow: true,
  },
  {
    name: "capture: unknown reason rejected",
    path: "capture.negative_unknownReason",
    parse: parseCaptureResult,
    expectThrow: true,
  },

  // retract
  {
    name: "retract: success memory",
    path: "retract.successMemory",
    parse: parseRetractResult,
  },
  {
    name: "retract: success knowledge",
    path: "retract.successKnowledge",
    parse: parseRetractResult,
  },
  {
    name: "retract: success tasks moved to dropped",
    path: "retract.successTasks",
    parse: parseRetractResult,
  },
  {
    name: "retract: success inbox",
    path: "retract.successInbox",
    parse: parseRetractResult,
  },
  {
    name: "retract: no_contributors arm",
    path: "retract.noContributors",
    parse: parseRetractResult,
  },
  {
    name: "retract: not_found arm",
    path: "retract.notFound",
    parse: parseRetractResult,
  },
  {
    name: "retract: contributor_failed arm",
    path: "retract.contributorFailed",
    parse: parseRetractResult,
  },
  {
    name: "retract: unknown target rejected",
    path: "retract.negative_unknownTarget",
    parse: parseRetractResult,
    expectThrow: true,
  },
  {
    name: "retract: unknown reason rejected",
    path: "retract.negative_unknownReason",
    parse: parseRetractResult,
    expectThrow: true,
  },

  // semantic search
  {
    name: "knowledgeSearch: success",
    path: "knowledgeSearch.success",
    parse: parseKnowledgeSearchResponse,
  },
  {
    name: "knowledgeSearch: semantic_unavailable",
    path: "knowledgeSearch.semanticUnavailable",
    parse: parseKnowledgeSearchResponse,
  },
  {
    name: "knowledgeSearch: unknown reason rejected",
    path: "knowledgeSearch.negative_unknownReason",
    parse: parseKnowledgeSearchResponse,
    expectThrow: true,
  },
  {
    name: "memorySearch: success",
    path: "memorySearch.success",
    parse: parseMemorySearchResponse,
  },
  {
    name: "memorySearch: semantic_unavailable",
    path: "memorySearch.semanticUnavailable",
    parse: parseMemorySearchResponse,
  },
  {
    name: "memorySearch: unknown reason rejected",
    path: "memorySearch.negative_unknownReason",
    parse: parseMemorySearchResponse,
    expectThrow: true,
  },
  {
    name: "historySearch: success",
    path: "historySearch.success",
    parse: parseHistorySearchResponse,
  },
  {
    name: "historySearch: semantic_unavailable",
    path: "historySearch.semanticUnavailable",
    parse: parseHistorySearchResponse,
  },
  {
    name: "historySearch: unknown reason rejected",
    path: "historySearch.negative_unknownReason",
    parse: parseHistorySearchResponse,
    expectThrow: true,
  },
  {
    name: "tasksSearch: success",
    path: "tasksSearch.success",
    parse: parseTasksSearchResponse,
  },
  {
    name: "tasksSearch: semantic_unavailable",
    path: "tasksSearch.semanticUnavailable",
    parse: parseTasksSearchResponse,
  },
  {
    name: "tasksSearch: unknown reason rejected",
    path: "tasksSearch.negative_unknownReason",
    parse: parseTasksSearchResponse,
    expectThrow: true,
  },

  // attention + digest + voice
  {
    name: "attention: data + items + text",
    path: "attention",
    parse: parseAttentionResponse,
  },
  {
    name: "digest: full envelope",
    path: "digest",
    parse: parseDigestResponse,
  },
  {
    name: "voice: transcribe success",
    path: "voice.transcribeSuccess",
    parse: parseVoiceTranscribeResult,
  },
  {
    name: "voice: transcribe failure (stt-unavailable)",
    path: "voice.transcribeFailureSttUnavailable",
    parse: (raw) => parseVoiceFailure(raw as Record<string, unknown>),
  },
  {
    name: "voice: transcribe failure (stt-failed)",
    path: "voice.transcribeFailureSttFailed",
    parse: (raw) => parseVoiceFailure(raw as Record<string, unknown>),
  },
  {
    name: "voice: synthesize failure (tts-unavailable)",
    path: "voice.synthesizeFailureTtsUnavailable",
    parse: (raw) => parseVoiceFailure(raw as Record<string, unknown>),
  },
  {
    name: "voice: synthesize failure (tts-format-unsupported with supported list)",
    path: "voice.synthesizeFailureTtsFormatUnsupported",
    parse: (raw) => parseVoiceFailure(raw as Record<string, unknown>),
  },
  {
    name: "voice: unknown failure code rejected",
    path: "voice.negative_unknownCode",
    parse: (raw) => parseVoiceFailure(raw as Record<string, unknown>),
    expectThrow: true,
  },
];

/** Resolve a dotted path through the canonical fixture tree. */
export function readFixturePath(tree: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current === null || typeof current !== "object") {
      throw new Error(`fixture path ${path} broke at segment "${key}"`);
    }
    const val = (current as Record<string, unknown>)[key];
    if (val === undefined) {
      throw new Error(`fixture path ${path} missing segment "${key}"`);
    }
    return val;
  }, tree);
}
