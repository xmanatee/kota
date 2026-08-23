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
  isProgressBoundary,
  pendingInputFromPayload,
  progressReviewDispatchKey,
  readConsumptionState,
  writeConsumptionState,
} from "./semantic-input-state.js";

export {
  progressReviewDispatchKey,
  readPendingProgressReviewInput,
  recordProgressReviewInputQueued,
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

export function deferProgressReviewSemanticInput(args: {
  projectDir: string;
  input: ProgressReviewSemanticInput;
}): void {
  if (!args.input.automatic || args.input.inputRevision === null) return;
  const state = readConsumptionState(args.projectDir);
  const priorAttempt = state.pendingInput?.inputRevision === args.input.inputRevision
    ? state.pendingInput.deliveryAttempt
    : args.input.deliveryAttempt;
  const pending = pendingInputFromPayload({
    automatic: true,
    boundary: args.input.boundary === "explicit-request"
      ? undefined
      : args.input.boundary,
    inputRevision: args.input.inputRevision,
    evidenceRefs: args.input.evidenceRefs,
    reason: args.input.reason,
    deliveryAttempt: priorAttempt + 1,
  }, "deferred");
  if (pending.inputRevision <= state.lastConsumedRevision) return;
  if (
    state.pendingInput &&
    state.pendingInput.inputRevision > pending.inputRevision
  ) {
    return;
  }
  writeConsumptionState(args.projectDir, { ...state, pendingInput: pending });
}

export function inspectProgressReviewSemanticInput(args: {
  projectDir: string;
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
  const state = readConsumptionState(args.projectDir);
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
  const state = readConsumptionState(input.projectDir);
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
  if (
    state.pendingInput &&
    payload.inputRevision! < state.pendingInput.inputRevision
  ) {
    return {
      admitted: false,
      reason:
        `semantic revision ${payload.inputRevision} was superseded by ` +
        `${state.pendingInput.inputRevision}`,
    };
  }
  return { admitted: true };
}

export function recordProgressReviewSemanticInput(args: {
  projectDir: string;
  input: ProgressReviewSemanticInput;
  consumedAt: string;
}): void {
  if (!args.input.automatic || args.input.inputRevision === null) return;
  const state = readConsumptionState(args.projectDir);
  if (args.input.inputRevision <= state.lastConsumedRevision) return;
  writeConsumptionState(args.projectDir, {
    schemaVersion: 2,
    scopeId: state.scopeId,
    lastConsumedRevision: args.input.inputRevision,
    consumedAt: args.consumedAt,
    pendingInput:
      state.pendingInput &&
        state.pendingInput.inputRevision > args.input.inputRevision
        ? state.pendingInput
        : null,
  });
}
