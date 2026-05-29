import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowRunMetadata, WorkflowRunWarning } from "#core/workflow/run-types.js";
import { assertTaskQueueValid } from "#modules/repo-tasks/task-queue-validation.js";
import {
  applyWorkflowFailureEscalation,
  buildWorkflowFailureAttentionDigest,
  detectPersistentWorkflowFailurePatterns,
  detectPersistentWorkflowFailurePatternsFromRuns,
  proposeWorkflowFailureEscalation,
  type WorkflowFailurePattern,
} from "./workflow-failure-escalation.js";

const NOW = Date.parse("2026-05-29T12:00:00.000Z");

function makeRun(opts: {
  id: string;
  workflow: string;
  hoursAgo: number;
  status: WorkflowRunMetadata["status"];
  repairCheckId?: string;
  stepError?: string;
  warnings?: WorkflowRunWarning[];
}): WorkflowRunMetadata {
  const completedAt = new Date(NOW - opts.hoursAgo * 60 * 60 * 1000).toISOString();
  const failed = opts.status === "failed";
  const output = opts.repairCheckId
    ? {
        repairIterations: [
          {
            failures: [{ id: opts.repairCheckId }],
          },
        ],
      }
    : undefined;
  return {
    id: opts.id,
    workflow: opts.workflow,
    definitionPath: `src/modules/autonomy/workflows/${opts.workflow}/workflow.ts`,
    trigger: { event: "workflow.completed", payload: {} },
    startedAt: new Date(NOW - opts.hoursAgo * 60 * 60 * 1000 - 1000).toISOString(),
    completedAt,
    status: opts.status,
    durationMs: 1000,
    runDir: `.kota/runs/${opts.id}`,
    steps: [
      {
        id: "main",
        type: "agent",
        status: failed ? "failed" : "success",
        startedAt: completedAt,
        completedAt,
        durationMs: 1000,
        ...(output ? { output } : {}),
        ...(failed && opts.stepError ? { error: opts.stepError } : {}),
      },
    ],
    ...(opts.warnings ? { warnings: opts.warnings } : {}),
  };
}

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "workflow-failure-escalation-"));
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
  }
  mkdirSync(join(dir, ".kota", "runs"), { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  execFileSync("git", ["commit", "--allow-empty", "-m", "initial", "--quiet"], {
    cwd: dir,
  });
  return dir;
}

function writeRun(projectDir: string, run: WorkflowRunMetadata): void {
  const runDir = join(projectDir, ".kota", "runs", run.id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "metadata.json"), JSON.stringify(run, null, 2));
}

function applyFirstPattern(
  projectDir: string,
  pattern: WorkflowFailurePattern,
  nowIso = "2026-05-29T12:00:00.000Z",
) {
  const proposal = proposeWorkflowFailureEscalation(projectDir, pattern);
  return applyWorkflowFailureEscalation(proposal, {
    projectDir,
    nowIso,
  });
}

describe("detectPersistentWorkflowFailurePatternsFromRuns", () => {
  it("detects consecutive failures with the same terminal repair-check id", () => {
    const patterns = detectPersistentWorkflowFailurePatternsFromRuns(
      [
        makeRun({
          id: "run-a",
          workflow: "decomposer",
          hoursAgo: 3,
          status: "failed",
          repairCheckId: "task-queue-valid",
        }),
        makeRun({
          id: "run-b",
          workflow: "decomposer",
          hoursAgo: 2,
          status: "failed",
          repairCheckId: "task-queue-valid",
        }),
        makeRun({
          id: "run-c",
          workflow: "decomposer",
          hoursAgo: 1,
          status: "failed",
          repairCheckId: "task-queue-valid",
        }),
      ],
      { nowMs: NOW },
    );

    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({
      kind: "consecutive-failures",
      workflow: "decomposer",
      signalKind: "repair-check",
      signalId: "task-queue-valid",
      runIds: ["run-a", "run-b", "run-c"],
    });
    expect(patterns[0].fingerprint).toContain("workflow-failure:consecutive-failures");
    expect(patterns[0].taskId).toMatch(/^task-repair-workflow-failure-pattern-/);
  });

  it("detects 100% terminal failure rate when failure classes differ across the window", () => {
    const patterns = detectPersistentWorkflowFailurePatternsFromRuns(
      [
        makeRun({
          id: "rate-a",
          workflow: "fan-out-consolidator",
          hoursAgo: 60,
          status: "failed",
          stepError: "missing fan out source a",
        }),
        makeRun({
          id: "rate-b",
          workflow: "fan-out-consolidator",
          hoursAgo: 36,
          status: "failed",
          stepError: "missing fan out source b",
        }),
        makeRun({
          id: "rate-c",
          workflow: "fan-out-consolidator",
          hoursAgo: 1,
          status: "failed",
          stepError: "missing fan out source c",
        }),
      ],
      { nowMs: NOW },
    );

    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({
      kind: "terminal-failure-rate",
      workflow: "fan-out-consolidator",
      signalId: "terminal-failure-rate-100",
    });
  });

  it("detects repeated completed-with-warnings on the same warning type when there are no failures", () => {
    const warning = {
      type: "task-queue-valid",
      message: "task queue validation warning",
    };
    const patterns = detectPersistentWorkflowFailurePatternsFromRuns(
      [
        makeRun({
          id: "warn-a",
          workflow: "builder",
          hoursAgo: 4,
          status: "completed-with-warnings",
          warnings: [warning],
        }),
        makeRun({
          id: "warn-b",
          workflow: "builder",
          hoursAgo: 2,
          status: "completed-with-warnings",
          warnings: [warning],
        }),
        makeRun({
          id: "warn-c",
          workflow: "builder",
          hoursAgo: 1,
          status: "completed-with-warnings",
          warnings: [warning],
        }),
      ],
      { nowMs: NOW },
    );

    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({
      kind: "repeated-warning",
      workflow: "builder",
      signalKind: "repair-warning",
      signalId: "task-queue-valid",
    });
  });

  it("does not emit a resolved consecutive pattern after a success breaks the streak", () => {
    const patterns = detectPersistentWorkflowFailurePatternsFromRuns(
      [
        makeRun({
          id: "old-a",
          workflow: "decomposer",
          hoursAgo: 4,
          status: "failed",
          repairCheckId: "task-queue-valid",
        }),
        makeRun({
          id: "old-b",
          workflow: "decomposer",
          hoursAgo: 3,
          status: "failed",
          repairCheckId: "task-queue-valid",
        }),
        makeRun({
          id: "old-c",
          workflow: "decomposer",
          hoursAgo: 2,
          status: "failed",
          repairCheckId: "task-queue-valid",
        }),
        makeRun({
          id: "new-success",
          workflow: "decomposer",
          hoursAgo: 1,
          status: "success",
        }),
      ],
      { nowMs: NOW },
    );

    expect(patterns).toEqual([]);
  });

  it("ignores classified infrastructure failures", () => {
    const error =
      'Agent step "build" failed (codex_cli_error): You have hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again later.';
    const patterns = detectPersistentWorkflowFailurePatternsFromRuns(
      [
        makeRun({
          id: "infra-a",
          workflow: "builder",
          hoursAgo: 3,
          status: "failed",
          stepError: error,
        }),
        makeRun({
          id: "infra-b",
          workflow: "builder",
          hoursAgo: 2,
          status: "failed",
          stepError: error,
        }),
        makeRun({
          id: "infra-c",
          workflow: "builder",
          hoursAgo: 1,
          status: "failed",
          stepError: error,
        }),
      ],
      { nowMs: NOW },
    );

    expect(patterns).toEqual([]);
  });
});

describe("workflow failure escalation tasks", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("creates one valid ready task for a synthetic run-artifact pattern", () => {
    writeRun(
      projectDir,
      makeRun({
        id: "fs-a",
        workflow: "security-review",
        hoursAgo: 3,
        status: "failed",
        repairCheckId: "typecheck",
      }),
    );
    writeRun(
      projectDir,
      makeRun({
        id: "fs-b",
        workflow: "security-review",
        hoursAgo: 2,
        status: "failed",
        repairCheckId: "typecheck",
      }),
    );
    writeRun(
      projectDir,
      makeRun({
        id: "fs-c",
        workflow: "security-review",
        hoursAgo: 1,
        status: "failed",
        repairCheckId: "typecheck",
      }),
    );

    const patterns = detectPersistentWorkflowFailurePatterns(
      join(projectDir, ".kota", "runs"),
      { nowMs: NOW },
    );
    expect(patterns).toHaveLength(1);
    const applied = applyFirstPattern(projectDir, patterns[0]);
    expect(applied.kind).toBe("created");

    const taskPath = join(
      projectDir,
      "data",
      "tasks",
      "ready",
      `${patterns[0].taskId}.md`,
    );
    expect(existsSync(taskPath)).toBe(true);
    const content = readFileSync(taskPath, "utf-8");
    expect(content).toContain("status: ready");
    expect(content).toContain("fs-a, fs-b, fs-c");
    expect(content).toContain(patterns[0].fingerprint);
    expect(content).toContain(patterns[0].evidenceFingerprint);
    expect(assertTaskQueueValid(projectDir, { minReady: 1 }).errorCount).toBe(0);
  });

  it("suppresses duplicates and leaves the task file unchanged for identical evidence", () => {
    const pattern = detectPersistentWorkflowFailurePatternsFromRuns(
      [
        makeRun({
          id: "dupe-a",
          workflow: "inbox-sorter",
          hoursAgo: 3,
          status: "failed",
          repairCheckId: "lint",
        }),
        makeRun({
          id: "dupe-b",
          workflow: "inbox-sorter",
          hoursAgo: 2,
          status: "failed",
          repairCheckId: "lint",
        }),
        makeRun({
          id: "dupe-c",
          workflow: "inbox-sorter",
          hoursAgo: 1,
          status: "failed",
          repairCheckId: "lint",
        }),
      ],
      { nowMs: NOW },
    )[0];

    applyFirstPattern(projectDir, pattern);
    const taskPath = join(projectDir, "data", "tasks", "ready", `${pattern.taskId}.md`);
    const before = readFileSync(taskPath, "utf-8");
    const proposal = proposeWorkflowFailureEscalation(projectDir, pattern);
    expect(proposal.action).toBe("noop");
    const second = applyWorkflowFailureEscalation(proposal, {
      projectDir,
      nowIso: "2026-05-29T13:00:00.000Z",
    });
    expect(second.kind).toBe("noop");
    expect(readFileSync(taskPath, "utf-8")).toBe(before);
  });

  it("formats operator attention without cost fields", () => {
    const digest = buildWorkflowFailureAttentionDigest([
      {
        workflow: "builder",
        taskId: "task-repair-workflow-failure-pattern-abc123def456",
        action: "created",
        kind: "consecutive-failures",
        signal: "repair-check task-queue-valid",
        runIds: ["run-a", "run-b", "run-c"],
      },
    ]);

    expect(digest.items[0].detail).toContain("task-repair-workflow-failure-pattern");
    expect(digest.items[0].detail).toContain("run-a, run-b, run-c");
    expect(JSON.stringify(digest)).not.toMatch(/cost|throughput/i);
  });
});
