import { describe, expect, it, vi } from "vitest";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import {
  buildDiffSummaryConsistencyRecord,
  collectGitNameStatus,
  type DiffSummaryNameStatus,
  parseGitNameStatus,
} from "./diff-summary-consistency.js";
import type { AutonomyRunDeliveryEvidence } from "./run-delivery-evidence.js";

const KNOWN_MODULES = ["autonomy", "eval-harness", "repo-tasks"];

function delivery(
  commitMessage: string,
  filesChanged: string[],
  overrides: Partial<AutonomyRunDeliveryEvidence> = {},
): AutonomyRunDeliveryEvidence {
  return {
    version: 1,
    runId: "2026-06-24T00-00-00-000Z-builder-test",
    workflow: "builder",
    scopeId: "scope-test",
    targetBranch: "main",
    baseHead: "base123",
    integratedFromHead: "base123",
    publishedHead: "abc123",
    commitSubject: commitMessage,
    commitMessage,
    changedPaths: filesChanged,
    completedAt: "2026-06-24T00:00:00.000Z",
    taskId: "task-eval-harness",
    taskTitle: "Fix eval-harness recorder guard",
    cost: { state: "unknown" },
    durationMs: null,
    ...overrides,
  };
}

function task(body = "## Problem\n\nFix eval-harness recorder guard\n") {
  return {
    id: "task-eval-harness",
    title: "Fix eval-harness recorder guard",
    body,
    state: "done" as const,
  };
}

function status(path: string, kind: DiffSummaryNameStatus["status"] = "modified"): DiffSummaryNameStatus {
  return { status: kind, path };
}

describe("diff-summary consistency diagnostic", () => {
  it("accepts a clean run whose declared scope matches changed module and buckets", () => {
    const files = [
      "src/modules/eval-harness/recorder.ts",
      "src/modules/eval-harness/recorder.test.ts",
      "data/tasks/archive/task-eval-harness.md",
    ];

    const record = buildDiffSummaryConsistencyRecord({
      delivery: delivery("Fix eval-harness recorder guard", files),
      commitMessageFile: "Fix eval-harness recorder guard",
      task: task(),
      nameStatus: files.map((file) => status(file)),
      knownModuleNames: KNOWN_MODULES,
    });

    expect(record.mismatches).toEqual([]);
    expect(record.facts.moduleNames).toEqual(["eval-harness"]);
    expect(record.facts.fileBuckets).toEqual([
      { bucket: "production", count: 1 },
      { bucket: "task", count: 1 },
      { bucket: "test", count: 1 },
    ]);
    expect(record.facts.taskArchived).toBe(true);
  });

  it("flags task-only completions that claim implementation work", () => {
    const files = ["data/tasks/archive/task-eval-harness.md"];
    const record = buildDiffSummaryConsistencyRecord({
      delivery: delivery("Fix eval-harness recorder guard", files),
      commitMessageFile: "Fix eval-harness recorder guard",
      task: task(),
      nameStatus: files.map((file) => status(file)),
      knownModuleNames: KNOWN_MODULES,
    });

    expect(record.mismatches.map((mismatch) => mismatch.category)).toContain(
      "task-only-implementation-claim",
    );
  });

  it("flags narrow summaries that hide broad production churn", () => {
    const files = [
      "src/modules/eval-harness/recorder.ts",
      "src/modules/eval-harness/agent-step-recording.ts",
      "src/modules/autonomy/report/aggregate.ts",
      "src/modules/autonomy/report/render.ts",
    ];

    const record = buildDiffSummaryConsistencyRecord({
      delivery: delivery("Fix eval-harness recorder guard", files),
      commitMessageFile: "Fix eval-harness recorder guard",
      task: task(),
      nameStatus: files.map((file) => status(file)),
      knownModuleNames: KNOWN_MODULES,
    });

    expect(record.mismatches.map((mismatch) => mismatch.category)).toContain(
      "broad-source-churn-omitted",
    );
  });

  it("flags generated or baseline changes omitted from declared text", () => {
    const files = [
      "src/modules/eval-harness/recorder.ts",
      "src/strict-types-policy-baseline.json",
    ];

    const record = buildDiffSummaryConsistencyRecord({
      delivery: delivery("Fix eval-harness recorder guard", files),
      commitMessageFile: "Fix eval-harness recorder guard",
      task: task(),
      nameStatus: files.map((file) => status(file)),
      knownModuleNames: KNOWN_MODULES,
    });

    expect(record.facts.generatedOrBaselineChanged).toBe(true);
    expect(record.mismatches.map((mismatch) => mismatch.category)).toContain(
      "generated-or-baseline-omitted",
    );
  });

  it("records missing metadata explicitly instead of inferring scope", () => {
    const record = buildDiffSummaryConsistencyRecord({
      delivery: null,
      commitMessageFile: null,
      task: null,
      nameStatus: null,
      knownModuleNames: KNOWN_MODULES,
    });

    expect(record.missingData).toEqual([
      "writer-integration",
      "commit-message-file",
      "diff-name-status",
    ]);
    expect(record.mismatches).toEqual([]);
  });

  it("parses git name-status output into bounded diff facts", () => {
    const parsed = parseGitNameStatus(
      "A\tnew.ts\nM\tsrc/modules/autonomy/report.ts\nD\told.ts\nR100\tbefore.ts\tafter.ts\n",
    );

    expect(parsed).toEqual([
      { status: "added", path: "new.ts" },
      { status: "modified", path: "src/modules/autonomy/report.ts" },
      { status: "deleted", path: "old.ts" },
      { status: "renamed", previousPath: "before.ts", path: "after.ts" },
    ]);
  });

  it("collects commit-range facts through the injected workflow runner", async () => {
    const runCommand = vi.fn(successfulWorkflowCommandRun);
    runCommand.mockResolvedValueOnce({
      ...(await successfulWorkflowCommandRun({ command: "git" })),
      stdout: {
        text: "M\tsrc/runtime.ts\nA\tsrc/runtime.test.ts\n",
        totalBytes: 41,
        truncated: false,
      },
    });

    await expect(
      collectGitNameStatus("/project", runCommand, "base123", "head456"),
    ).resolves.toEqual([
      { status: "modified", path: "src/runtime.ts" },
      { status: "added", path: "src/runtime.test.ts" },
    ]);
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "git",
        args: ["diff", "--name-status", "base123..head456", "--"],
        cwd: "/project",
      }),
    );
  });
});
