import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { collectReviewOutcomeReport } from "./review-outcomes.js";

const NOW = "2026-06-23T12:00:00.000Z";

function reviewRun(
  runsDir: string,
  id: string,
  workflow: string,
  overrides: Partial<WorkflowRunMetadata> = {},
): WorkflowRunMetadata {
  const run: WorkflowRunMetadata = {
    id,
    workflow,
    definitionPath: `src/modules/autonomy/workflows/${workflow}/workflow.ts`,
    trigger: { event: "test", schemaRef: null, payload: {} },
    startedAt: NOW,
    completedAt: NOW,
    status: "success",
    runDir: `.kota/runs/${id}`,
    steps: [],
    ...overrides,
  };
  const dir = join(runsDir, id);
  mkdirSync(dir, { recursive: true });
  return run;
}

function writeJson(runsDir: string, runId: string, file: string, value: object): void {
  writeFileSync(
    join(runsDir, runId, file),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf-8",
  );
}

function progressReview(verdict: string, localScope: object): object {
  return {
    generatedAt: NOW,
    evidence: {},
    reviewInput: {},
    review: {
      verdict,
      summary: "Reviewed the current evidence window.",
      findings: {
        crossScope: { claims: [], followUpTasks: [] },
        localScope,
      },
      ownerQuestions: [],
    },
    actions: { createdTaskIds: [], ownerQuestionIds: [], applied: [], touchedTaskQueue: false },
  };
}

function builderTrigger(taskId: string): WorkflowRunMetadata["trigger"] {
  const taskDigest = "0".repeat(64);
  return {
    event: "autonomy.queue.available",
    schemaRef: null,
    payload: {
      taskId,
      taskPath: `data/tasks/${taskId}.md`,
      taskState: "open",
      taskDigest,
      idempotencyKey: `builder:${taskId}:${taskDigest}`,
      title: taskId,
    },
  };
}

describe("review outcome aggregation", () => {
  let workspaceRoot: string;
  let runsDir: string;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `review-outcomes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    runsDir = join(workspaceRoot, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("keeps accepted, failed and absent reviews distinct and attributable to their tasks", () => {
    const firstRun = reviewRun(runsDir, "first-builder-run", "builder", {
      trigger: builderTrigger("task-from-first-trigger"),
    });
    writeJson(runsDir, firstRun.id, "critic-review.json", {
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Accepted with no findings.",
    });

    const secondRun = reviewRun(runsDir, "second-builder-run", "builder", {
      trigger: builderTrigger("task-from-second-trigger"),
    });
    writeJson(runsDir, secondRun.id, "critic-review.json", {
      verdict: "pass_with_warnings",
      critical_issues: [],
      warnings: ["Tracked follow-up exists."],
      summary: "Accepted with a warning.",
    });

    const failed = reviewRun(runsDir, "failed", "builder", { trigger: builderTrigger("task-failed") });
    writeJson(runsDir, failed.id, "critic-review.json", {
      verdict: "fail", critical_issues: ["Required behavior is absent."], warnings: [], summary: "Incomplete.",
    });
    const unknown = reviewRun(runsDir, "unknown", "builder");
    const report = collectReviewOutcomeReport({ runsDir, runs: [firstRun, secondRun, failed, unknown] });
    expect(report).toMatchObject({ totalReviews: 3, approvalLikeDecisions: 2, unsupportedArtifacts: 0 });
    expect(report.records.map((record) => record.decision)).toEqual(["pass", "pass_with_warnings", "fail"]);

    expect(report.records.map((record) => record.taskId)).toEqual([
      "task-from-first-trigger",
      "task-from-second-trigger",
      "task-failed",
    ]);
  });

  it.each(["{not-json", JSON.stringify({ verdict: "pass" })])(
    "reports malformed evidence as unsupported rather than approval: %s",
    (content) => {
      const run = reviewRun(runsDir, "invalid", "builder");
      writeFileSync(join(runsDir, run.id, "critic-review.json"), content);
      const report = collectReviewOutcomeReport({ runsDir, runs: [run] });
      expect(report).toMatchObject({ records: [], approvalLikeDecisions: 0, unsupportedArtifacts: 1 });
      expect(report.unsupported[0]).toMatchObject({ runId: run.id, workflow: "builder", artifact: "critic-review.json" });
    },
  );
  it("projects original progress, semantic and PR decisions without a scrutiny artifact", () => {
    const progress = reviewRun(runsDir, "progress", "progress-reviewer");
    writeJson(runsDir, progress.id, "progress-review.json", progressReview("on-track", { claims: [], followUpTasks: [] }));
    const semantic = reviewRun(runsDir, "semantic", "improver");
    writeJson(runsDir, semantic.id, "semantic-gate-review.json", {
      verdict: "pass", critical_issues: [], warnings: [], summary: "The existing API serves both callers.",
    });
    const pr = reviewRun(runsDir, "pr", "pr-reviewer", { steps: [{
      id: "prepare-comment", type: "code", status: "success", startedAt: NOW, completedAt: NOW, durationMs: 1,
      output: { repo: "example/project", prNumber: 42, recommendation: "approve" },
    }] });
    const report = collectReviewOutcomeReport({ runsDir, runs: [progress, semantic, pr] });
    expect(report).toMatchObject({ totalReviews: 3, approvalLikeDecisions: 3, unsupportedArtifacts: 0 });
    expect(report.records.map(({ decision }) => decision)).toEqual(["on-track", "pass", "approve"]);
  });

});
