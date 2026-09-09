import { z } from "zod";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { improvementHandoffObservationSchema } from "#modules/autonomy/improvement-handoff.js";
import type { ProgressReviewRequest } from "./events.js";

const pendingHandoffSchema = improvementHandoffObservationSchema.extend({
  evidenceRefs: z.array(z.string().min(1)).min(1),
});
export type PendingProgressReviewHandoff = z.infer<typeof pendingHandoffSchema>;

export const PROGRESS_REVIEW_STATE_KEY =
  "autonomy/progress-review/semantic-input";

export type ProgressReviewBoundary = Exclude<
  ProgressReviewRequest["boundary"],
  undefined
>;

export type ProgressReviewConsumptionState = {
  schemaVersion: 1;
  scopeId: string;
  lastConsumedRevision: number;
  consumedAt: string | null;
  consumedExplicitRunIds: string[];
  proposalObservations: Array<{
    proposalKey: string;
    generatedAt: string;
    handoffFingerprint?: string;
    pendingHandoff?: PendingProgressReviewHandoff;
  }>;
};

export function progressReviewDispatchKey(
  scopeId: string,
  inputRevision: number,
  deliveryAttempt: number,
): string {
  return `progress-review:${scopeId}:${inputRevision}:${deliveryAttempt}`;
}

export function emptyProgressReviewConsumptionState(
  scopeRoot: string,
): ProgressReviewConsumptionState {
  return {
    schemaVersion: 1,
    scopeId: deriveDirectoryScopeId(scopeRoot),
    lastConsumedRevision: 0,
    consumedAt: null,
    consumedExplicitRunIds: [],
    proposalObservations: [],
  };
}

export function decodeProgressReviewConsumptionState(
  value: unknown,
  scopeRoot: string,
): ProgressReviewConsumptionState {
  if (value === null || value === undefined) {
    return emptyProgressReviewConsumptionState(scopeRoot);
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("progress review semantic state must be an object");
  }
  const state = value as Partial<ProgressReviewConsumptionState>;
  // Existing persisted automatic watermarks predate publication receipts.
  const consumedExplicitRunIds = state.consumedExplicitRunIds === undefined
    ? [] : state.consumedExplicitRunIds;
  const proposalObservations = state.proposalObservations === undefined
    ? [] : state.proposalObservations;
  if (
    state.schemaVersion !== 1 ||
    state.scopeId !== deriveDirectoryScopeId(scopeRoot) ||
    !Number.isSafeInteger(state.lastConsumedRevision) ||
    state.lastConsumedRevision! < 0 ||
    (state.consumedAt !== null && typeof state.consumedAt !== "string") ||
    !Array.isArray(consumedExplicitRunIds) ||
    consumedExplicitRunIds.some((id) => typeof id !== "string" || id.length === 0) ||
    !Array.isArray(proposalObservations) ||
    proposalObservations.some((entry) => !entry ||
      typeof entry.proposalKey !== "string" || entry.proposalKey.length === 0 ||
      typeof entry.generatedAt !== "string" || !Number.isFinite(Date.parse(entry.generatedAt)) ||
      (entry.handoffFingerprint !== undefined && !/^[a-f0-9]{64}$/.test(entry.handoffFingerprint)) ||
      (entry.pendingHandoff !== undefined &&
        (!pendingHandoffSchema.safeParse(entry.pendingHandoff).success ||
          entry.pendingHandoff.topicKey !== entry.proposalKey)))
  ) {
    throw new Error("progress review semantic state is invalid");
  }
  return { ...state, consumedExplicitRunIds, proposalObservations } as ProgressReviewConsumptionState;
}

export function isProgressBoundary(
  value: string | undefined,
): value is ProgressReviewBoundary {
  return value === "evidence-window" || value === "parked-queue" ||
    value === "strategic-completion" ||
    value === "task-disposition" ||
    value === "owner-decision-resolution";
}
