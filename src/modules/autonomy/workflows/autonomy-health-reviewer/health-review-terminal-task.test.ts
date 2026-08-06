import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowBatchFlushPayload } from "#core/workflow/trigger-types.js";
import {
  type AutonomyHealthSignalInput,
  normalizeHealthSignal,
} from "#modules/autonomy/health-signal.js";
import {
  applyAutonomyHealthReviewActions,
  buildAutonomyHealthReview,
} from "./health-review.js";

const NOW = "2026-06-17T12:30:00.000Z";

function signal(
  overrides: Partial<AutonomyHealthSignalInput> = {},
): ReturnType<typeof normalizeHealthSignal> {
  return normalizeHealthSignal({
    observation: "present",
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
    observationCount: 1,
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

describe("autonomy health review terminal task handling", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-health-review-terminal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectDir });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("reopens the stable repair task when a completed issue recurs", () => {
    const doneDir = join(projectDir, "data", "tasks", "done");
    mkdirSync(doneDir, { recursive: true });
    writeFileSync(
      join(
        doneDir,
        "task-health-dead-letter-execution-workflow-runtime-progress-reviewer.md",
      ),
      [
        "---",
        "id: task-health-dead-letter-execution-workflow-runtime-progress-reviewer",
        "title: Repair autonomy health pattern dead-letter:execution:workflow-runtime:progress-reviewer",
        "status: done",
        "priority: p2",
        "area: autonomy",
        "summary: Prior progress-reviewer DLQ repair for older evidence.",
        `created_at: ${NOW}`,
        `updated_at: ${NOW}`,
        "task_class: Meta",
        "---",
        "",
        "<!-- autonomy-health-dedupe-key: dead-letter:execution:workflow-runtime:progress-reviewer -->",
        "<!-- autonomy-health-evidence-fingerprint: bf712eea3fd1821c -->",
        "",
        "## Resolution",
        "",
        "Older progress-reviewer write-scope DLQ evidence was handled.",
        "",
        "- .kota/dead-letter-queue/items.json#dlq-c3d9197c-110e-495d-ab5d-12e1de7925a7",
        "",
        "## Product / Safety Link",
        "",
        "This repair protects Product workflow execution from repeated DLQ failures.",
      ].join("\n"),
      "utf-8",
    );
    const currentDlqIds = [
      "dlq-112bbfd9-632e-460a-9a0b-4a126f4603f8",
      "dlq-15e44129-2278-490f-a3c4-dcf6a08c6d43",
      "dlq-8582e38e-3782-44d7-a1d7-db376727edfc",
    ];
    const review = buildAutonomyHealthReview({
      triggerPayload: batchPayload([
        signal({
          source: { kind: "dead-letter", id: currentDlqIds[0] },
          severity: "error",
          labels: ["dead-letter", "execution", "local-code"],
          actionability: "local-code",
          dedupeKey: "dead-letter:execution:workflow-runtime:progress-reviewer",
          summary:
            "Three progress-reviewer review-evidence timeout dead letters remain open.",
          evidenceRefs: currentDlqIds.map((id) => ({
            kind: "dead-letter" as const,
            ref: `.kota/dead-letter-queue/items.json#${id}`,
          })),
        }),
      ]),
      generatedAt: NOW,
    });
    const group = review.groups[0]!;
    const expectedTaskId =
      "task-health-dead-letter-execution-workflow-runtime-progress-reviewer";

    const actions = applyAutonomyHealthReviewActions({
      projectDir,
      runId: "health-review-run",
      review,
      nowIso: NOW,
    });

    expect(group.evidenceFingerprint).not.toBe("bf712eea3fd1821c");
    expect(actions.createdTaskIds).toEqual([]);
    expect(actions.applied).toEqual([
      expect.objectContaining({
        kind: "refreshed-task",
        taskId: expectedTaskId,
        dedupeKey: "dead-letter:execution:workflow-runtime:progress-reviewer",
      }),
    ]);
    const task = readFileSync(
      join(projectDir, "data", "tasks", "ready", `${expectedTaskId}.md`),
      "utf-8",
    );
    expect(task).toContain(
      "<!-- autonomy-health-dedupe-key: dead-letter:execution:workflow-runtime:progress-reviewer -->",
    );
    expect(task).toContain(
      `<!-- autonomy-health-evidence-fingerprint: ${group.evidenceFingerprint} -->`,
    );
    for (const id of currentDlqIds) {
      expect(task).toContain(id);
    }
  });
});
