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
  let projectDir: string;
  let runsDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-supervision-load-"));
    runsDir = join(projectDir, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("reports normal load when every store is present and quiet", () => {
    createKnownStores(projectDir);
    const tasks = [
      writeTask(projectDir, "ready", "task-ready", "Product", "p1"),
      writeTask(projectDir, "backlog", "task-backlog", "Platform", "p2"),
    ];

    const report = buildSupervisionLoadReport({
      projectDir,
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
    createKnownStores(projectDir);
    const tasks = [
      writeTask(projectDir, "doing", "task-alpha", "Product", "p1"),
      writeTask(projectDir, "doing", "task-beta", "Safety", "p0"),
      writeTask(projectDir, "ready", "task-ready", "Product", "p1"),
      writeTask(projectDir, "backlog", "task-backlog", "Platform", "p2"),
    ];
    writeApproval(projectDir, "approval-1", "pending");
    writeOwnerQuestion(projectDir, "question-1", "pending", "task-alpha");
    writeDeadLetters(projectDir, [
      {
        id: "dlq-1",
        status: "open",
        scopeId: "scope-a",
        projectId: "project-a",
      },
    ]);
    const runs = [
      runningRun(
        projectDir,
        "run-active",
        "builder",
        "task-alpha",
        "scope-a",
        "project-a",
      ),
    ];

    const report = buildSupervisionLoadReport({
      projectDir,
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
      attentionItems: 1,
    });
    expect(report.workstreams).toContainEqual(
      expect.objectContaining({
        workflow: "builder",
        taskClass: "Product",
        priority: "p1",
        scopeId: "scope-a",
        projectId: "project-a",
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
    createKnownStores(projectDir);
    const task = writeTask(
      projectDir,
      "ready",
      "task-target",
      "Product",
      "p1",
    );
    const run = runningRun(
      projectDir,
      "run-explorer",
      "explorer",
      task.id,
      "scope-a",
      "project-a",
    );

    const report = buildSupervisionLoadReport({
      projectDir,
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
        taskClass: "Unclassified",
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
    createKnownStores(projectDir);
    const tasks = [
      writeTask(projectDir, "ready", "task-ready", "Product", "p1"),
      writeTask(projectDir, "backlog", "task-backlog", "Platform", "p2"),
    ];

    const report = buildSupervisionLoadReport({
      projectDir,
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
    writeTask(projectDir, "ready", "task-ready", "Product", "p1");
    mkdirSync(join(projectDir, ".kota", "approvals"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "approvals", "broken.json"),
      "{",
      "utf-8",
    );

    const report = buildSupervisionLoadReport({
      projectDir,
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
