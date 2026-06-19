import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowBatchFlushPayload } from "#core/workflow/trigger-types.js";
import { type AutonomyHealthSignalInput, normalizeHealthSignal } from "#modules/autonomy/health-signal.js";
import { validateTaskQueue } from "#modules/repo-tasks/task-queue-validation.js";
import {
  applyAutonomyHealthReviewActions,
  buildAutonomyHealthReview,
  writeAutonomyHealthReviewArtifact,
} from "./health-review.js";

const NOW = "2026-06-17T12:30:00.000Z";

function signal(
  overrides: Partial<AutonomyHealthSignalInput> = {},
): ReturnType<typeof normalizeHealthSignal> {
  return normalizeHealthSignal({
    source: { kind: "workflow", id: "builder" },
    severity: "warning",
    labels: ["runtime"],
    summary: "Builder repeatedly hit the same local runtime issue.",
    evidenceRefs: [
      {
        kind: "run",
        ref: ".kota/runs/builder-1/metadata.json",
        summary: "builder run builder-1",
      },
    ],
    actionability: "local-code",
    dedupeKey: "workflow:builder:runtime-warning",
    createdAt: NOW,
    ...overrides,
  });
}

function batchPayload(signals: ReturnType<typeof signal>[]): WorkflowBatchFlushPayload {
  return {
    scopeId: "scope-a",
    projectId: "scope-a",
    sourceEventName: "autonomy.health.signal",
    groupingKey: "scopeId=scope-a|labelsKey=runtime",
    reason: "count",
    count: signals.length,
    window: {
      firstEventAt: signals[0]?.createdAt ?? NOW,
      lastEventAt: signals.at(-1)?.createdAt ?? NOW,
      flushedAt: NOW,
    },
    inputEvents: signals.map((item, index) => ({
      event: "autonomy.health.signal",
      schemaRef: null,
      receivedAt: item.createdAt,
      payload: item,
      eventId: `evt-${index + 1}`,
    })),
    batch: {
      workflow: "autonomy-health-reviewer",
      triggerIndex: 1,
      maxBufferSize: 20,
      overflow: "flush-oldest",
      droppedInputCount: 0,
    },
  };
}

describe("autonomy health review actions", () => {
  let projectDir: string;
  let runDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-health-review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    runDir = join(projectDir, ".kota", "runs", "health-review-run");
    mkdirSync(runDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("creates one deduped repair task for repeated local-code signals", () => {
    const first = signal();
    const second = signal({
      evidenceRefs: [
        {
          kind: "run",
          ref: ".kota/runs/builder-2/metadata.json",
          summary: "builder run builder-2",
        },
      ],
      createdAt: "2026-06-17T12:05:00.000Z",
    });
    const review = buildAutonomyHealthReview({
      triggerPayload: batchPayload([first, second]),
      generatedAt: NOW,
    });

    const actions = applyAutonomyHealthReviewActions({
      projectDir,
      runId: "health-review-run",
      review,
      nowIso: NOW,
    });

    expect(actions.createdTaskIds).toHaveLength(1);
    expect(actions.ownerQuestionIds).toHaveLength(0);
    expect(actions.applied).toEqual([
      expect.objectContaining({
        kind: "created-task",
        taskId: "task-health-workflow-builder-runtime-warning",
      }),
    ]);
    const taskPath = join(
      projectDir,
      "data",
      "tasks",
      "ready",
      "task-health-workflow-builder-runtime-warning.md",
    );
    expect(existsSync(taskPath)).toBe(true);
    const task = readFileSync(taskPath, "utf-8");
    expect(task).toContain("runtime");
    expect(task).toContain(".kota/runs/builder-1/metadata.json");
    expect(task).toContain(".kota/runs/builder-2/metadata.json");
    expect(task).toContain("## Initiative");
    expect(task).toContain("<!-- autonomy-health-dedupe-key: workflow:builder:runtime-warning -->");
  });

  it("creates a staged task that passes task queue validation", () => {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectDir });
    execFileSync("git", ["config", "user.email", "t@example.com"], {
      cwd: projectDir,
    });
    execFileSync("git", ["config", "user.name", "test"], { cwd: projectDir });
    execFileSync("git", ["config", "commit.gpgsign", "false"], {
      cwd: projectDir,
    });

    const review = buildAutonomyHealthReview({
      triggerPayload: batchPayload([signal(), signal()]),
      generatedAt: NOW,
    });

    applyAutonomyHealthReviewActions({
      projectDir,
      runId: "health-review-run",
      review,
      nowIso: NOW,
    });

    const result = validateTaskQueue(projectDir);
    expect(result.findings.map((finding) => finding.code)).not.toContain(
      "strategic-task-missing-initiative",
    );
    expect(result.findings.map((finding) => finding.code)).not.toContain(
      "strategic-task-weak-initiative",
    );
    expect(result.findings.map((finding) => finding.code)).not.toContain(
      "task-untracked",
    );
    expect(result.errorCount).toBe(0);
  });

  it("does not churn a task when duplicate evidence is reviewed again", () => {
    const review = buildAutonomyHealthReview({
      triggerPayload: batchPayload([signal(), signal()]),
      generatedAt: NOW,
    });
    const first = applyAutonomyHealthReviewActions({
      projectDir,
      runId: "health-review-run",
      review,
      nowIso: NOW,
    });
    const second = applyAutonomyHealthReviewActions({
      projectDir,
      runId: "health-review-run-2",
      review,
      nowIso: "2026-06-17T13:00:00.000Z",
    });

    expect(first.createdTaskIds).toHaveLength(1);
    expect(second.createdTaskIds).toHaveLength(0);
    expect(second.applied).toEqual([
      expect.objectContaining({
        kind: "skipped-task",
        reason: expect.stringContaining("already records this evidence"),
      }),
    ]);
  });

  it("routes operator-action signals to owner questions rather than repair tasks", () => {
    const review = buildAutonomyHealthReview({
      triggerPayload: batchPayload([
        signal({
          severity: "error",
          labels: ["operator-action", "external-service"],
          actionability: "owner-action",
          dedupeKey: "telegram:duplicate-consumer:getupdates",
          summary: "Telegram getUpdates conflict needs operator decision.",
        }),
      ]),
      generatedAt: NOW,
    });

    const actions = applyAutonomyHealthReviewActions({
      projectDir,
      runId: "health-review-run",
      review,
      nowIso: NOW,
    });

    expect(actions.createdTaskIds).toHaveLength(0);
    expect(actions.ownerQuestionIds).toHaveLength(1);
    expect(existsSync(join(projectDir, ".kota", "owner-questions"))).toBe(true);
    expect(actions.applied[0]).toEqual(
      expect.objectContaining({
        kind: "owner-question",
      }),
    );
  });

  it("writes a bounded health review artifact", () => {
    const review = buildAutonomyHealthReview({
      triggerPayload: batchPayload([signal()]),
      generatedAt: NOW,
    });
    const artifactPath = writeAutonomyHealthReviewArtifact(runDir, {
      generatedAt: NOW,
      review,
      actions: {
        createdTaskIds: [],
        ownerQuestionIds: [],
        applied: [],
        touchedTaskQueue: false,
      },
    });

    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
    expect(artifact.review.groups[0]).toMatchObject({
      dedupeKey: "workflow:builder:runtime-warning",
      labels: ["runtime"],
      signalCount: 1,
    });
    expect(JSON.stringify(artifact)).not.toContain("prompt");
  });
});
