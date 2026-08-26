import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { ProgressReviewRequest } from "./events.js";

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
  if (
    state.schemaVersion !== 1 ||
    state.scopeId !== deriveDirectoryScopeId(scopeRoot) ||
    !Number.isSafeInteger(state.lastConsumedRevision) ||
    state.lastConsumedRevision! < 0 ||
    (state.consumedAt !== null && typeof state.consumedAt !== "string")
  ) {
    throw new Error("progress review semantic state is invalid");
  }
  return state as ProgressReviewConsumptionState;
}

export function isProgressBoundary(
  value: string | undefined,
): value is ProgressReviewBoundary {
  return value === "parked-queue" ||
    value === "strategic-completion" ||
    value === "task-disposition" ||
    value === "owner-decision-resolution";
}
