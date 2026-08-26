import type { TransactionalRunState } from "#core/workflow/run-context.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type {
  WorkflowTriggerAdmissionDecision,
  WorkflowTriggerAdmissionInput,
} from "#core/workflow/types.js";
import {
  automaticProgressReviewRequested,
  type ProgressReviewRequest,
} from "./events.js";
import {
  decodeProgressReviewConsumptionState,
  isProgressBoundary,
  PROGRESS_REVIEW_STATE_KEY,
  type ProgressReviewConsumptionState,
  progressReviewDispatchKey,
} from "./semantic-input-state.js";

export type { ProgressReviewConsumptionState } from "./semantic-input-state.js";
export {
  decodeProgressReviewConsumptionState,
  PROGRESS_REVIEW_STATE_KEY,
  progressReviewDispatchKey,
} from "./semantic-input-state.js";

export type ProgressReviewSemanticInput = {
  automatic: boolean;
  shouldReview: boolean;
  boundary: Exclude<ProgressReviewRequest["boundary"], undefined> | "explicit-request";
  inputRevision: number | null;
  evidenceRefs: string[];
  reason: string;
  deliveryAttempt: number;
};

export function inspectProgressReviewSemanticInput(args: {
  scopeDir: string;
  state: Pick<TransactionalRunState, "read">;
  trigger: WorkflowRunTrigger;
}): ProgressReviewSemanticInput {
  const payload = args.trigger.payload as ProgressReviewRequest;
  if (payload.automatic !== true) {
    return {
      automatic: false,
      shouldReview: true,
      boundary: "explicit-request",
      inputRevision: null,
      evidenceRefs: Array.isArray(payload.evidenceRefs)
        ? payload.evidenceRefs.filter((ref): ref is string => typeof ref === "string")
        : [],
      reason: payload.reason ?? "explicit progress review request",
      deliveryAttempt: 0,
    };
  }
  if (!payload.boundary || !Number.isInteger(payload.inputRevision)) {
    throw new Error(
      "automatic progress review requires boundary and integer inputRevision",
    );
  }
  const revision = payload.inputRevision!;
  if (revision <= 0) {
    throw new Error("automatic progress review inputRevision must be positive");
  }
  const state = decodeProgressReviewConsumptionState(
    args.state.read<ProgressReviewConsumptionState>(PROGRESS_REVIEW_STATE_KEY).value,
    args.scopeDir,
  );
  return {
    automatic: true,
    shouldReview: revision > state.lastConsumedRevision,
    boundary: payload.boundary,
    inputRevision: revision,
    evidenceRefs: Array.isArray(payload.evidenceRefs)
      ? payload.evidenceRefs.filter((ref): ref is string => typeof ref === "string")
      : [],
    reason: payload.reason ?? payload.boundary,
    deliveryAttempt:
      Number.isInteger(payload.deliveryAttempt) && payload.deliveryAttempt! >= 0
        ? payload.deliveryAttempt!
        : 0,
  };
}

export function admitProgressReviewTrigger(
  input: WorkflowTriggerAdmissionInput,
): WorkflowTriggerAdmissionDecision {
  if (input.trigger.event !== automaticProgressReviewRequested.name) {
    return { admitted: true };
  }
  const payload = input.trigger.payload as ProgressReviewRequest;
  if (
    payload.automatic !== true ||
    !isProgressBoundary(payload.boundary) ||
    !Number.isInteger(payload.inputRevision) ||
    payload.inputRevision! <= 0
  ) {
    return {
      admitted: false,
      reason: "automatic progress input is missing its semantic revision",
    };
  }
  const state = decodeProgressReviewConsumptionState(
    input.state.read<ProgressReviewConsumptionState>(PROGRESS_REVIEW_STATE_KEY).value,
    input.projectDir,
  );
  const deliveryAttempt = Number.isInteger(payload.deliveryAttempt) &&
      payload.deliveryAttempt! >= 0
    ? payload.deliveryAttempt!
    : 0;
  const expectedKey = progressReviewDispatchKey(
    state.scopeId,
    payload.inputRevision!,
    deliveryAttempt,
  );
  if (payload.idempotencyKey !== expectedKey) {
    return {
      admitted: false,
      reason: "automatic progress input has no canonical dispatch key",
    };
  }
  if (payload.inputRevision! <= state.lastConsumedRevision) {
    return {
      admitted: false,
      reason: `semantic revision ${payload.inputRevision} was already consumed`,
    };
  }
  return { admitted: true };
}

export function completeProgressReviewSemanticInput(args: {
  current: ProgressReviewConsumptionState;
  input: Pick<ProgressReviewSemanticInput, "automatic" | "inputRevision">;
  consumedAt: string;
}): ProgressReviewConsumptionState {
  if (!args.input.automatic || args.input.inputRevision === null) {
    return args.current;
  }
  if (args.input.inputRevision <= args.current.lastConsumedRevision) {
    return args.current;
  }
  return {
    schemaVersion: 1,
    scopeId: args.current.scopeId,
    lastConsumedRevision: args.input.inputRevision,
    consumedAt: args.consumedAt,
  };
}
