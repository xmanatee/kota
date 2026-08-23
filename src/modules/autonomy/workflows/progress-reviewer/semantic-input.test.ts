import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deferProgressReviewSemanticInput,
  inspectProgressReviewSemanticInput,
  readPendingProgressReviewInput,
  recordProgressReviewInputQueued,
  recordProgressReviewSemanticInput,
} from "./semantic-input.js";

describe("progress review semantic consumption", () => {
  const projectDirs: string[] = [];

  afterEach(() => {
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  function project(): string {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-progress-consumption-"));
    projectDirs.push(projectDir);
    return projectDir;
  }

  it("consumes an automatic revision once and accepts a later revision", () => {
    const projectDir = project();
    const trigger = {
      event: "autonomy.progress-review.requested",
      schemaRef: null,
      payload: {
        automatic: true,
        boundary: "parked-queue" as const,
        inputRevision: 4,
        evidenceRefs: ["data/tasks/done/task-delivery.md"],
      },
    };

    const first = inspectProgressReviewSemanticInput({ projectDir, trigger });
    expect(first).toMatchObject({ shouldReview: true, inputRevision: 4 });
    recordProgressReviewSemanticInput({
      projectDir,
      input: first,
      consumedAt: "2026-08-15T12:00:00.000Z",
    });
    expect(inspectProgressReviewSemanticInput({ projectDir, trigger })).toMatchObject({
      shouldReview: false,
      inputRevision: 4,
    });

    expect(
      inspectProgressReviewSemanticInput({
        projectDir,
        trigger: {
          ...trigger,
          payload: { ...trigger.payload, inputRevision: 5 },
        },
      }),
    ).toMatchObject({ shouldReview: true, inputRevision: 5 });
  });

  it("keeps only the latest queued revision across dirty deferral and earlier consumption", () => {
    const projectDir = project();
    const revisionFour = {
      event: "autonomy.progress-review.requested",
      schemaRef: null,
      payload: {
        automatic: true,
        boundary: "parked-queue" as const,
        inputRevision: 4,
        evidenceRefs: ["data/tasks/done/task-delivery.md"],
      },
    };
    recordProgressReviewInputQueued({
      projectDir,
      payload: revisionFour.payload,
    });
    const inspectedFour = inspectProgressReviewSemanticInput({
      projectDir,
      trigger: revisionFour,
    });
    deferProgressReviewSemanticInput({ projectDir, input: inspectedFour });
    expect(readPendingProgressReviewInput(projectDir)).toMatchObject({
      inputRevision: 4,
      delivery: "deferred",
      deliveryAttempt: 1,
      payload: {
        deliveryAttempt: 1,
        idempotencyKey: expect.stringContaining(":4:1"),
      },
    });

    recordProgressReviewInputQueued({
      projectDir,
      payload: { ...revisionFour.payload, inputRevision: 5 },
    });
    recordProgressReviewSemanticInput({
      projectDir,
      input: inspectedFour,
      consumedAt: "2026-08-15T12:00:00.000Z",
    });
    expect(readPendingProgressReviewInput(projectDir)).toMatchObject({
      inputRevision: 5,
      delivery: "queued",
      deliveryAttempt: 0,
    });
  });

  it("keeps explicit requests reviewable without advancing the automatic watermark", () => {
    const projectDir = project();
    const trigger = {
      event: "autonomy.progress-review.requested",
      schemaRef: null,
      payload: { reason: "operator requested a review" },
    };
    const input = inspectProgressReviewSemanticInput({ projectDir, trigger });
    expect(input).toMatchObject({
      automatic: false,
      shouldReview: true,
      boundary: "explicit-request",
      inputRevision: null,
    });
    recordProgressReviewSemanticInput({
      projectDir,
      input,
      consumedAt: "2026-08-15T12:00:00.000Z",
    });
    expect(inspectProgressReviewSemanticInput({ projectDir, trigger }).shouldReview)
      .toBe(true);
  });

  it("rejects malformed automatic requests before review work starts", () => {
    const projectDir = project();
    expect(() =>
      inspectProgressReviewSemanticInput({
        projectDir,
        trigger: {
          event: "autonomy.progress-review.requested",
          schemaRef: null,
          payload: { automatic: true, boundary: "task-disposition" },
        },
      }),
    ).toThrow(/inputRevision/);
  });
});
