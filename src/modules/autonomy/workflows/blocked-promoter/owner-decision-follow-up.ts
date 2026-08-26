import { join } from "node:path";
import type { OwnerAskCandidate } from "./promotion.js";

export const BLOCKED_OWNER_DECISION_REQUESTED_EVENT =
  "autonomy.blocked.owner-decision.requested";
export const BLOCKED_OWNER_DECISION_RESOLVED_EVENT =
  "autonomy.blocked.owner-decision.resolved";

export type BlockedOwnerDecisionCandidate = Omit<OwnerAskCandidate, "taskPath">;

export type BlockedOwnerDecisionRequest = {
  requestKey: string;
  candidate: BlockedOwnerDecisionCandidate;
  displayedAnswers: string[];
};

export type BlockedOwnerDecisionResolution = BlockedOwnerDecisionRequest & {
  approved: boolean;
  outcomeKind: "answered" | "dismissed" | "expired" | "timeout";
  decidedAt: string;
};

export function blockedOwnerDecisionKey(
  candidate: BlockedOwnerDecisionCandidate,
): string {
  return `blocked-owner-decision:${candidate.taskId}:${candidate.slot}:${candidate.requestRevision}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function decodeBlockedOwnerDecisionRequest(
  value: object,
): BlockedOwnerDecisionRequest {
  const request = value as Partial<BlockedOwnerDecisionRequest>;
  const candidate = request.candidate as Partial<BlockedOwnerDecisionCandidate> | undefined;
  if (
    !candidate ||
    typeof candidate.taskId !== "string" ||
    typeof candidate.slot !== "string" ||
    typeof candidate.question !== "string" ||
    (candidate.context !== null && typeof candidate.context !== "string") ||
    !isStringArray(candidate.proposedAnswers) ||
    (candidate.recommendedAnswer !== null &&
      typeof candidate.recommendedAnswer !== "string") ||
    typeof candidate.requestRevision !== "string" ||
    !isStringArray(request.displayedAnswers) ||
    request.requestKey !== blockedOwnerDecisionKey(
      candidate as BlockedOwnerDecisionCandidate,
    )
  ) {
    throw new Error("blocked owner-decision request is invalid");
  }
  return request as BlockedOwnerDecisionRequest;
}

export function decodeBlockedOwnerDecisionResolution(
  value: object,
): BlockedOwnerDecisionResolution {
  const resolution = value as Partial<BlockedOwnerDecisionResolution>;
  const candidate = resolution.candidate as BlockedOwnerDecisionCandidate | undefined;
  const requestKey = candidate ? blockedOwnerDecisionKey(candidate) : "";
  const request = decodeBlockedOwnerDecisionRequest(value);
  if (
    request.requestKey !== requestKey ||
    typeof resolution.approved !== "boolean" ||
    (resolution.outcomeKind !== "answered" &&
      resolution.outcomeKind !== "dismissed" &&
      resolution.outcomeKind !== "expired" &&
      resolution.outcomeKind !== "timeout") ||
    typeof resolution.decidedAt !== "string" ||
    Number.isNaN(Date.parse(resolution.decidedAt))
  ) {
    throw new Error("blocked owner-decision resolution is invalid");
  }
  return { ...request, ...resolution } as BlockedOwnerDecisionResolution;
}

export function ownerAskCandidateForWorkspace(
  workspaceRoot: string,
  candidate: BlockedOwnerDecisionCandidate,
): OwnerAskCandidate {
  return {
    ...candidate,
    taskPath: join(
      workspaceRoot,
      "data",
      "tasks",
      "blocked",
      `${candidate.taskId}.md`,
    ),
  };
}
