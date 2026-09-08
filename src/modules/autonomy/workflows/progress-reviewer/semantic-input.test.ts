import { describe, expect, it } from "vitest";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import {
  completeProgressReviewSemanticInput,
  decodeProgressReviewConsumptionState,
  inspectProgressReviewSemanticInput,
  PROGRESS_REVIEW_STATE_KEY,
  type ProgressReviewConsumptionState,
  planProgressReviewPublication,
} from "./semantic-input.js";

describe("progress review semantic consumption", () => {
  const scopeRoot = process.cwd();
  const automaticTrigger = {
    event: "autonomy.progress-review.requested",
    schemaRef: null,
    payload: {
      automatic: true,
      boundary: "parked-queue" as const,
      inputRevision: 4,
      evidenceRefs: ["data/tasks/archive/task-delivery.md"],
    },
  };

  it("publishes the consumed watermark through compare-and-set", () => {
    const state = createTestTransactionalRunState();
    const input = inspectProgressReviewSemanticInput({
      scopeRoot,
      state,
      trigger: automaticTrigger,
    });
    expect(input).toMatchObject({ shouldReview: true, inputRevision: 4 });

    const snapshot = state.read<ProgressReviewConsumptionState>(
      PROGRESS_REVIEW_STATE_KEY,
    );
    const next = completeProgressReviewSemanticInput({
      current: decodeProgressReviewConsumptionState(snapshot.value, scopeRoot),
      input,
      consumedAt: "2026-08-15T12:00:00.000Z",
    });
    state.compareAndSet(PROGRESS_REVIEW_STATE_KEY, snapshot.revision, next);

    expect(inspectProgressReviewSemanticInput({
      scopeRoot,
      state,
      trigger: automaticTrigger,
    })).toMatchObject({ shouldReview: false, inputRevision: 4 });
    expect(inspectProgressReviewSemanticInput({
      scopeRoot,
      state,
      trigger: {
        ...automaticTrigger,
        payload: { ...automaticTrigger.payload, inputRevision: 5 },
      },
    })).toMatchObject({ shouldReview: true, inputRevision: 5 });
  });

  it("rejects a stale competing publication instead of overwriting it", () => {
    const state = createTestTransactionalRunState();
    const first = state.read<ProgressReviewConsumptionState>(
      PROGRESS_REVIEW_STATE_KEY,
    );
    state.compareAndSet(
      PROGRESS_REVIEW_STATE_KEY,
      first.revision,
      completeProgressReviewSemanticInput({
        current: decodeProgressReviewConsumptionState(first.value, scopeRoot),
        input: { automatic: true, inputRevision: 5 },
        consumedAt: "2026-08-15T12:00:00.000Z",
      }),
    );
    expect(() => state.compareAndSet(
      PROGRESS_REVIEW_STATE_KEY,
      first.revision,
      completeProgressReviewSemanticInput({
        current: decodeProgressReviewConsumptionState(first.value, scopeRoot),
        input: { automatic: true, inputRevision: 4 },
        consumedAt: "2026-08-15T12:01:00.000Z",
      }),
    )).toThrow(/revision mismatch/);
  });

  it("keeps explicit requests reviewable without advancing automatic state", () => {
    const state = createTestTransactionalRunState();
    const trigger = {
      event: "autonomy.progress-review.requested",
      schemaRef: null,
      payload: { reason: "operator requested a review" },
    };
    const input = inspectProgressReviewSemanticInput({ scopeRoot, state, trigger });
    const current = decodeProgressReviewConsumptionState(
      state.read<ProgressReviewConsumptionState>(PROGRESS_REVIEW_STATE_KEY).value,
      scopeRoot,
    );
    expect(input).toMatchObject({
      automatic: false,
      shouldReview: true,
      boundary: "explicit-request",
      inputRevision: null,
    });
    expect(completeProgressReviewSemanticInput({
      current,
      input,
      consumedAt: "2026-08-15T12:00:00.000Z",
    })).toBe(current);
  });

  it("rejects malformed automatic requests before review work starts", () => {
    const state = createTestTransactionalRunState();
    expect(() => inspectProgressReviewSemanticInput({
      scopeRoot,
      state,
      trigger: {
        event: "autonomy.progress-review.requested",
        schemaRef: null,
        payload: { automatic: true, boundary: "task-disposition" },
      },
    })).toThrow(/inputRevision/);
  });
});


it("retains explicit publication receipts when automatic consumption advances", () => {
  const scopeRoot = process.cwd();
  const planned = planProgressReviewPublication({
    current: decodeProgressReviewConsumptionState(null, scopeRoot),
    input: { automatic: false, inputRevision: null },
    sourceRunId: "explicit-review", generatedAt: "2026-09-07T10:00:00.000Z",
    proposalKeys: ["progress-reviewer:direction"],
  });
  const advanced = completeProgressReviewSemanticInput({
    current: planned.nextState,
    input: { automatic: true, inputRevision: 4 },
    consumedAt: "2026-09-07T11:00:00.000Z",
  });
  const restored = decodeProgressReviewConsumptionState(JSON.parse(JSON.stringify(advanced)), scopeRoot);
  expect(restored.consumedExplicitRunIds).toEqual(["explicit-review"]);
  expect(restored.proposalObservations).toEqual(planned.nextState.proposalObservations);
  expect(restored.lastConsumedRevision).toBe(4);
  expect(planProgressReviewPublication({
    current: restored, input: { automatic: false, inputRevision: null },
    sourceRunId: "explicit-review", generatedAt: "2026-09-07T10:00:00.000Z",
    proposalKeys: ["progress-reviewer:direction"],
  })).toMatchObject({ replay: true, nextState: restored });
});

it("upgrades persisted automatic watermarks and rejects malformed publication receipts", () => {
  const scopeRoot = process.cwd();
  const empty = decodeProgressReviewConsumptionState(null, scopeRoot);
  const legacy = {
    schemaVersion: empty.schemaVersion, scopeId: empty.scopeId,
    lastConsumedRevision: 4, consumedAt: "2026-09-07T10:00:00.000Z",
  };
  expect(decodeProgressReviewConsumptionState(legacy, scopeRoot)).toEqual({
    ...empty, ...legacy,
  });
  for (const malformed of [
    { consumedExplicitRunIds: null },
    { consumedExplicitRunIds: [42] },
    { proposalObservations: [{ proposalKey: "direction", generatedAt: "invalid" }] },
  ]) {
    expect(() => decodeProgressReviewConsumptionState({ ...legacy, ...malformed }, scopeRoot)).toThrow(/semantic state is invalid/);
  }
});
