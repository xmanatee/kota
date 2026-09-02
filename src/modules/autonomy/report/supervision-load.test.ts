import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyAutonomyReportData } from "./report-test-fixtures.js";
import { buildSupervisionLoadReport } from "./supervision-load.js";
import {
  createKnownStores,
  NOW,
  runningRun,
  writeApproval,
  writeDeadLetters,
  writeOwnerQuestion,
  writeTask,
} from "./supervision-load.test-helpers.js";

describe("buildSupervisionLoadReport", () => {
  let workspaceRoot: string;
  let runsDir: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "kota-supervision-load-"));
    runsDir = join(workspaceRoot, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("reports normal load when every store is present and quiet", () => {
    createKnownStores(workspaceRoot);
    const tasks = [
      writeTask(workspaceRoot, "open", "task-active", "p1"),
      writeTask(workspaceRoot, "open", "task-open", "p2"),
    ];

    const report = buildSupervisionLoadReport({
      workspaceRoot,
      stateDir: join(workspaceRoot, ".kota"),
      runsDir,
      runs: [],
      tasks,
      windowEndMs: NOW,
      reviewScrutiny: emptyAutonomyReportData.reviewScrutiny,
      postCompletionFollowUps: emptyAutonomyReportData.postCompletionFollowUps,
    });

    expect(report.status).toBe("normal");
    expect(report.score).toMatchObject({
      score: 0,
      knownScore: 0,
      unknownEvidenceCount: 0,
    });
    expect(report.evidence.every((item) => item.status === "available")).toBe(
      true,
    );
    expect(report.counts).toEqual({
      activeRuns: 0,
      pendingApprovals: 0,
      pendingOwnerQuestions: 0,
      openDeadLetters: 0,
      attentionItems: 0,
      postCompletionFollowUps: 0,
      reviewEvidenceGaps: 0,
    });
  });

  it("reports overloaded load with human-action stores and multi-scope workstreams", () => {
    createKnownStores(workspaceRoot);
    const tasks = [
      writeTask(workspaceRoot, "open", "task-alpha", "p1"),
      writeTask(workspaceRoot, "open", "task-beta", "p0"),
      writeTask(workspaceRoot, "open", "task-active", "p1"),
      writeTask(workspaceRoot, "open", "task-open", "p2"),
    ];
    writeApproval(workspaceRoot, "approval-1", "pending");
    writeOwnerQuestion(workspaceRoot, "question-1", "pending", "task-alpha");
    writeDeadLetters(workspaceRoot, [
      {
        id: "dlq-1",
        status: "open",
        scopeId: "scope-a",
      },
    ]);
    const runs = [
      runningRun(
        workspaceRoot,
        "run-active",
        "builder",
        "task-alpha",
        "scope-a",
      ),
    ];

    const report = buildSupervisionLoadReport({
      workspaceRoot,
      stateDir: join(workspaceRoot, ".kota"),
      runsDir,
      runs,
      tasks,
      windowEndMs: NOW,
      reviewScrutiny: emptyAutonomyReportData.reviewScrutiny,
      postCompletionFollowUps: emptyAutonomyReportData.postCompletionFollowUps,
    });

    expect(report.status).toBe("overloaded");
    expect(report.score.score).toBeGreaterThanOrEqual(
      report.thresholds.overloadedAt,
    );
    expect(report.counts).toMatchObject({
      activeRuns: 1,
      pendingApprovals: 1,
      pendingOwnerQuestions: 1,
      openDeadLetters: 1,
      attentionItems: 0,
    });
    expect(report.workstreams).toContainEqual(
      expect.objectContaining({
        workflow: "builder",
        priority: "p1",
        scopeId: "scope-a",
        activeRuns: 1,
      }),
    );
    expect(report.topReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "active-run",
          id: "run-active",
          taskId: "task-alpha",
          taskTitle: "task-alpha title",
        }),
        expect.objectContaining({ kind: "approval", id: "approval-1" }),
        expect.objectContaining({ kind: "owner-question", id: "question-1" }),
        expect.objectContaining({ kind: "dead-letter", id: "dlq-1" }),
      ]),
    );
  });

  it("uses builder trigger metadata as the task association boundary", () => {
    createKnownStores(workspaceRoot);
    const task = writeTask(
      workspaceRoot,
      "open",
      "task-target",
      "p1",
    );
    const run = runningRun(
      workspaceRoot,
      "run-explorer",
      "explorer",
      task.id,
      "scope-a",
    );

    const report = buildSupervisionLoadReport({
      workspaceRoot,
      stateDir: join(workspaceRoot, ".kota"),
      runsDir,
      runs: [run],
      tasks: [task],
      windowEndMs: NOW,
      reviewScrutiny: emptyAutonomyReportData.reviewScrutiny,
      postCompletionFollowUps: emptyAutonomyReportData.postCompletionFollowUps,
    });

    expect(report.workstreams).toContainEqual(
      expect.objectContaining({
        workflow: "explorer",
        priority: "unknown",
      }),
    );
    expect(report.topReferences).toContainEqual(
      expect.objectContaining({
        kind: "active-run",
        id: "run-explorer",
        taskId: null,
        taskTitle: null,
      }),
    );
  });

  it("weights review evidence gaps as supervision pressure", () => {
    createKnownStores(workspaceRoot);
    const tasks = [
      writeTask(workspaceRoot, "open", "task-active", "p1"),
      writeTask(workspaceRoot, "open", "task-open", "p2"),
    ];

    const report = buildSupervisionLoadReport({
      workspaceRoot,
      stateDir: join(workspaceRoot, ".kota"),
      runsDir,
      runs: [],
      tasks,
      windowEndMs: NOW,
      reviewScrutiny: {
        ...emptyAutonomyReportData.reviewScrutiny,
        thinAcceptances: 1,
        absentMetricCount: 1,
        unsupportedArtifacts: 1,
      },
      postCompletionFollowUps: emptyAutonomyReportData.postCompletionFollowUps,
    });

    expect(report.counts.reviewEvidenceGaps).toBe(3);
    expect(report.score.knownScore).toBe(3);
    expect(report.status).toBe("busy");
  });

  it("renders missing and unreadable stores as unknown evidence instead of zero load", () => {
    writeTask(workspaceRoot, "open", "task-active", "p1");
    mkdirSync(join(workspaceRoot, ".kota", "approvals"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, ".kota", "approvals", "broken.json"),
      "{",
      "utf-8",
    );

    const report = buildSupervisionLoadReport({
      workspaceRoot,
      stateDir: join(workspaceRoot, ".kota"),
      runsDir,
      runs: [],
      tasks: [],
      windowEndMs: NOW,
      reviewScrutiny: emptyAutonomyReportData.reviewScrutiny,
      postCompletionFollowUps: emptyAutonomyReportData.postCompletionFollowUps,
    });

    expect(report.status).toBe("unknown");
    expect(report.score.score).toBeNull();
    expect(report.counts.pendingApprovals).toBeNull();
    expect(report.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "approvals", status: "unreadable" }),
        expect.objectContaining({ source: "dead-letters", status: "missing" }),
      ]),
    );
  });
});
