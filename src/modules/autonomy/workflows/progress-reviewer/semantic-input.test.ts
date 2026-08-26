import { describe, expect, it } from "vitest";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import {
  completeProgressReviewSemanticInput,
  decodeProgressReviewConsumptionState,
  inspectProgressReviewSemanticInput,
  PROGRESS_REVIEW_STATE_KEY,
  type ProgressReviewConsumptionState,
} from "./semantic-input.js";

describe("progress review semantic consumption", () => {
  const scopeDir = process.cwd();
  const automaticTrigger = {
    event: "autonomy.progress-review.requested",
    schemaRef: null,
    payload: {
      automatic: true,
      boundary: "parked-queue" as const,
      inputRevision: 4,
      evidenceRefs: ["data/tasks/done/task-delivery.md"],
    },
  };

  it("publishes the consumed watermark through compare-and-set", () => {
    const state = createTestTransactionalRunState();
    const input = inspectProgressReviewSemanticInput({
      scopeDir,
      state,
      trigger: automaticTrigger,
    });
    expect(input).toMatchObject({ shouldReview: true, inputRevision: 4 });

    const snapshot = state.read<ProgressReviewConsumptionState>(
      PROGRESS_REVIEW_STATE_KEY,
    );
    const next = completeProgressReviewSemanticInput({
      current: decodeProgressReviewConsumptionState(snapshot.value, scopeDir),
      input,
      consumedAt: "2026-08-15T12:00:00.000Z",
    });
    state.compareAndSet(PROGRESS_REVIEW_STATE_KEY, snapshot.revision, next);

    expect(inspectProgressReviewSemanticInput({
      scopeDir,
      state,
      trigger: automaticTrigger,
    })).toMatchObject({ shouldReview: false, inputRevision: 4 });
    expect(inspectProgressReviewSemanticInput({
      scopeDir,
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
        current: decodeProgressReviewConsumptionState(first.value, scopeDir),
        input: { automatic: true, inputRevision: 5 },
        consumedAt: "2026-08-15T12:00:00.000Z",
      }),
    );
    expect(() => state.compareAndSet(
      PROGRESS_REVIEW_STATE_KEY,
      first.revision,
      completeProgressReviewSemanticInput({
        current: decodeProgressReviewConsumptionState(first.value, scopeDir),
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
    const input = inspectProgressReviewSemanticInput({ scopeDir, state, trigger });
    const current = decodeProgressReviewConsumptionState(
      state.read<ProgressReviewConsumptionState>(PROGRESS_REVIEW_STATE_KEY).value,
      scopeDir,
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
      scopeDir,
      state,
      trigger: {
        event: "autonomy.progress-review.requested",
        schemaRef: null,
        payload: { automatic: true, boundary: "task-disposition" },
      },
    })).toThrow(/inputRevision/);
  });
});
