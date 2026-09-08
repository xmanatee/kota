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
  scopeRoot: string;
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
    args.scopeRoot,
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
    input.scopeRoot,
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
    ...args.current,
    lastConsumedRevision: args.input.inputRevision,
    consumedAt: args.consumedAt,
  };
}

/** Explicit requests are lossless, but cannot replay or replace newer topics. */
export function planProgressReviewPublication(args: {
  current: ProgressReviewConsumptionState;
  input: Pick<ProgressReviewSemanticInput, "automatic" | "inputRevision">;
  sourceRunId: string;
  generatedAt: string;
  proposalKeys: readonly string[];
}): {
  replay: boolean;
  freshProposalKeys: Set<string>;
  nextState: ProgressReviewConsumptionState;
} {
  const replay = !args.input.automatic &&
    args.current.consumedExplicitRunIds.includes(args.sourceRunId);
  const consumed = completeProgressReviewSemanticInput({
    current: args.current, input: args.input, consumedAt: args.generatedAt,
  });
  const fresh = !replay && (!args.input.automatic || consumed !== args.current);
  const freshProposalKeys = new Set(args.proposalKeys.filter((proposalKey) =>
    fresh && !args.current.proposalObservations.some((entry) =>
      entry.proposalKey === proposalKey && entry.generatedAt > args.generatedAt),
  ));
  if (replay || (args.input.automatic && !fresh)) {
    return { replay, freshProposalKeys, nextState: args.current };
  }
  return {
    replay,
    freshProposalKeys,
    nextState: {
      ...consumed,
      consumedExplicitRunIds: args.input.automatic
        ? consumed.consumedExplicitRunIds
        : [...consumed.consumedExplicitRunIds, args.sourceRunId],
      proposalObservations: [
        ...consumed.proposalObservations.filter((entry) => !freshProposalKeys.has(entry.proposalKey)),
        ...[...freshProposalKeys].map((proposalKey) => ({ proposalKey, generatedAt: args.generatedAt })),
      ],
    },
  };
}
