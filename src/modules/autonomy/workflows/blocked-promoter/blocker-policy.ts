import {
  type BlockedPrecondition,
  type BlockedPreconditionKind,
  type evaluateBlockedPrecondition,
  readOperatorCaptureInstructedMarker,
  readOwnerAskMarkers,
} from "#modules/repo-tasks/blocked-precondition.js";
import type { BlockedTaskRecord } from "./promotion.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const OPERATOR_CAPTURE_AGE_DAYS = 14;
const BLOCKER_ACTION_INTERVAL_MS = 14 * MS_PER_DAY;

export function freshBlockerActionAt(
  precondition: BlockedPrecondition,
  body: string,
  nowMs: number,
): string | null {
  const stamp = precondition.kind === "owner-decision"
    ? readOwnerAskMarkers(body).find((marker) => marker.slot === precondition.slot)?.lastAskedAt
    : precondition.kind === "operator-capture"
      ? readOperatorCaptureInstructedMarker(body)?.lastInstructedAt
      : undefined;
  return stamp !== undefined && nowMs - Date.parse(stamp) < BLOCKER_ACTION_INTERVAL_MS
    ? stamp : null;
}

const RECOMMENDED_LINE_RE = /(?:^|[\s.])recommended:\s*([a-z0-9][a-z0-9-_]*)/i;

/**
 * Pull a recommended-answer hint out of an owner-decision precondition's
 * free-form `context` field. Many tasks already write a `Recommended:
 * <variant-id>` sentence so a future re-ask carries the original author's
 * default. The parse is intentionally narrow: only a single ASCII slug
 * following the literal `Recommended:` is recognized; anything else returns
 * `null` so the workflow falls back to surfacing only proposed answers.
 */
export function extractRecommendedAnswer(
  context: string | null | undefined,
): string | null {
  if (!context) return null;
  const match = context.match(RECOMMENDED_LINE_RE);
  if (!match) return null;
  return match[1];
}

export type BlockerAction =
  | {
      kind: "auto-promotable";
      taskId: string;
      preconditionKind: BlockedPreconditionKind;
      reason: string;
      ageDays: number | null;
    }
  | {
      kind: "still-awaiting-dependency";
      taskId: string;
      preconditionKind: BlockedPreconditionKind;
      waitingOn: string[];
      ageDays: number | null;
    }
  | {
      kind: "still-awaiting-capability";
      taskId: string;
      preconditionKind: "capability-installed";
      probe: string;
      ageDays: number | null;
    }
  | {
      kind: "owner-ask-due";
      taskId: string;
      preconditionKind: "owner-decision";
      slot: string;
      recommendedAnswer: string | null;
      proposedAnswers: string[];
      ageDays: number | null;
    }
  | {
      kind: "owner-ask-recent";
      taskId: string;
      preconditionKind: "owner-decision";
      slot: string;
      lastAskedAt: string;
      ageDays: number | null;
    }
  | {
      kind: "operator-capture-due";
      taskId: string;
      preconditionKind: "operator-capture";
      capturePath: string;
      description: string;
      reason: string;
      ageDays: number | null;
    }
  | {
      kind: "operator-capture-recent";
      taskId: string;
      preconditionKind: "operator-capture";
      capturePath: string;
      lastInstructedAt: string;
      ageDays: number | null;
    }
  | {
      kind: "operator-capture-fresh";
      taskId: string;
      preconditionKind: "operator-capture";
      capturePath: string;
      ageDays: number | null;
    };


export function decideBlockedAction(input: {
  record: BlockedTaskRecord;
  nowMs: number;
  waitingOn: string[];
  evaluation: ReturnType<typeof evaluateBlockedPrecondition>;
}): BlockerAction {
  const { record, nowMs, waitingOn, evaluation } = input;
  const timestamp = Date.parse(record.updatedAt);
  const ageDays = Number.isNaN(timestamp) ? null : Math.floor((nowMs - timestamp) / MS_PER_DAY);
  const base = { taskId: record.id, ageDays };
  const precondition = record.precondition;
  if (waitingOn.length > 0) {
    return { ...base, kind: "still-awaiting-dependency", preconditionKind: precondition.kind, waitingOn };
  }
  if (evaluation.satisfied) {
    return { ...base, kind: "auto-promotable", preconditionKind: precondition.kind, reason: evaluation.reason };
  }
  const freshAt = freshBlockerActionAt(precondition, record.body, nowMs);
  switch (precondition.kind) {
    case "capability-installed":
      return { ...base, kind: "still-awaiting-capability", preconditionKind: precondition.kind, probe: precondition.probe };
    case "owner-decision":
      return freshAt === null ? {
        ...base, kind: "owner-ask-due", preconditionKind: precondition.kind,
        slot: precondition.slot, recommendedAnswer: extractRecommendedAnswer(precondition.context),
        proposedAnswers: precondition.proposedAnswers,
      } : {
        ...base, kind: "owner-ask-recent", preconditionKind: precondition.kind,
        slot: precondition.slot, lastAskedAt: freshAt,
      };
    case "operator-capture": {
      const capture = { ...base, preconditionKind: precondition.kind, capturePath: precondition.path };
      if (!evaluation.shouldRefreshInstruction && (ageDays === null || ageDays < OPERATOR_CAPTURE_AGE_DAYS)) {
        return { ...capture, kind: "operator-capture-fresh" };
      }
      return freshAt === null ? {
        ...capture, kind: "operator-capture-due", description: precondition.description, reason: evaluation.reason,
      } : { ...capture, kind: "operator-capture-recent", lastInstructedAt: freshAt };
    }
  }
}
