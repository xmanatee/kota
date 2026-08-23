import { join } from "node:path";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import {
  readOptionalJsonFile,
  writeJsonFileAtomic,
} from "#core/util/json-file.js";
import type { ProgressReviewRequest } from "./events.js";

const CONSUMPTION_STATE_PATH = join(
  ".kota",
  "progress-reviewer",
  "consumption-watermark.json",
);

export type ProgressReviewBoundary = Exclude<
  ProgressReviewRequest["boundary"],
  undefined
>;

export type PendingProgressReviewInput = {
  boundary: ProgressReviewBoundary;
  inputRevision: number;
  evidenceRefs: string[];
  reason: string;
  delivery: "queued" | "deferred";
  deliveryAttempt: number;
};

export type ProgressReviewConsumptionState = {
  schemaVersion: 2;
  scopeId: string;
  lastConsumedRevision: number;
  consumedAt: string | null;
  pendingInput: PendingProgressReviewInput | null;
};

type StoredProgressReviewConsumptionState = Partial<{
  schemaVersion: 1 | 2;
  scopeId: string;
  lastConsumedRevision: number;
  consumedAt: string | null;
  pendingInput: Partial<PendingProgressReviewInput> | null;
}>;

export function progressReviewDispatchKey(
  scopeId: string,
  inputRevision: number,
  deliveryAttempt: number,
): string {
  return `progress-review:${scopeId}:${inputRevision}:${deliveryAttempt}`;
}

export function readConsumptionState(
  projectDir: string,
): ProgressReviewConsumptionState {
  const scopeId = deriveDirectoryScopeId(projectDir);
  const state = readOptionalJsonFile<StoredProgressReviewConsumptionState>(
    join(projectDir, CONSUMPTION_STATE_PATH),
  );
  if (
    (state?.schemaVersion !== 1 && state?.schemaVersion !== 2) ||
    typeof state.scopeId !== "string" ||
    typeof state.lastConsumedRevision !== "number" ||
    (state.consumedAt !== null && typeof state.consumedAt !== "string")
  ) {
    return {
      schemaVersion: 2,
      scopeId,
      lastConsumedRevision: 0,
      consumedAt: null,
      pendingInput: null,
    };
  }
  const pending = state.schemaVersion === 2
    ? decodePendingInput(state.pendingInput)
    : null;
  return {
    schemaVersion: 2,
    scopeId,
    lastConsumedRevision: state.lastConsumedRevision,
    consumedAt: state.consumedAt,
    pendingInput:
      pending && pending.inputRevision > state.lastConsumedRevision
        ? pending
        : null,
  };
}

export function isProgressBoundary(
  value: string | undefined,
): value is ProgressReviewBoundary {
  return value === "parked-queue" ||
    value === "strategic-completion" ||
    value === "task-disposition" ||
    value === "owner-decision-resolution";
}

function decodePendingInput(
  value: StoredProgressReviewConsumptionState["pendingInput"],
): PendingProgressReviewInput | null {
  if (
    !value ||
    !isProgressBoundary(value.boundary) ||
    !Number.isInteger(value.inputRevision) ||
    value.inputRevision! <= 0 ||
    !Array.isArray(value.evidenceRefs) ||
    !value.evidenceRefs.every((ref) => typeof ref === "string") ||
    typeof value.reason !== "string" ||
    (value.delivery !== "queued" && value.delivery !== "deferred") ||
    (value.deliveryAttempt !== undefined &&
      (!Number.isInteger(value.deliveryAttempt) || value.deliveryAttempt! < 0))
  ) {
    return null;
  }
  return {
    boundary: value.boundary,
    inputRevision: value.inputRevision!,
    evidenceRefs: value.evidenceRefs,
    reason: value.reason,
    delivery: value.delivery,
    deliveryAttempt: value.deliveryAttempt ?? 0,
  };
}

export function writeConsumptionState(
  projectDir: string,
  state: ProgressReviewConsumptionState,
): void {
  writeJsonFileAtomic(join(projectDir, CONSUMPTION_STATE_PATH), state);
}

export function pendingInputFromPayload(
  payload: ProgressReviewRequest,
  delivery: PendingProgressReviewInput["delivery"],
): PendingProgressReviewInput {
  if (
    payload.automatic !== true ||
    !isProgressBoundary(payload.boundary) ||
    !Number.isInteger(payload.inputRevision) ||
    payload.inputRevision! <= 0
  ) {
    throw new Error(
      "automatic progress review delivery requires boundary and positive integer inputRevision",
    );
  }
  return {
    boundary: payload.boundary,
    inputRevision: payload.inputRevision!,
    evidenceRefs: Array.isArray(payload.evidenceRefs)
      ? payload.evidenceRefs.filter((ref): ref is string => typeof ref === "string")
      : [],
    reason: payload.reason ?? payload.boundary,
    delivery,
    deliveryAttempt:
      Number.isInteger(payload.deliveryAttempt) && payload.deliveryAttempt! >= 0
        ? payload.deliveryAttempt!
        : 0,
  };
}

export function readPendingProgressReviewInput(
  projectDir: string,
): (PendingProgressReviewInput & { payload: ProgressReviewRequest }) | null {
  const state = readConsumptionState(projectDir);
  const pending = state.pendingInput;
  if (!pending) return null;
  return {
    ...pending,
    payload: {
      automatic: true,
      boundary: pending.boundary,
      inputRevision: pending.inputRevision,
      evidenceRefs: [...pending.evidenceRefs],
      reason: pending.reason,
      requestedBy: "dispatcher",
      deliveryAttempt: pending.deliveryAttempt,
      idempotencyKey: progressReviewDispatchKey(
        state.scopeId,
        pending.inputRevision,
        pending.deliveryAttempt,
      ),
    },
  };
}

export function recordProgressReviewInputQueued(args: {
  projectDir: string;
  payload: ProgressReviewRequest;
}): void {
  const pending = pendingInputFromPayload(args.payload, "queued");
  const state = readConsumptionState(args.projectDir);
  if (pending.inputRevision <= state.lastConsumedRevision) return;
  if (
    state.pendingInput &&
    state.pendingInput.inputRevision > pending.inputRevision
  ) {
    return;
  }
  writeConsumptionState(args.projectDir, { ...state, pendingInput: pending });
}
