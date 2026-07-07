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
  writeClaim,
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
    expect(report.counts).toMatchObject({
      activeRuns: 0,
      activeTaskClaims: 0,
      pendingApprovals: 0,
      pendingOwnerQuestions: 0,
      openDeadLetters: 0,
      attentionItems: 0,
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
    writeClaim(projectDir, "task-alpha", "run-claim-active", "active");
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
      activeTaskClaims: 1,
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
        expect.objectContaining({ kind: "active-run", id: "run-active" }),
        expect.objectContaining({ kind: "approval", id: "approval-1" }),
        expect.objectContaining({ kind: "owner-question", id: "question-1" }),
        expect.objectContaining({ kind: "dead-letter", id: "dlq-1" }),
      ]),
    );
  });

  it("weights pending-merge claims as supervision pressure", () => {
    createKnownStores(projectDir);
    const tasks = [
      writeTask(projectDir, "ready", "task-pending", "Product", "p1"),
      writeTask(projectDir, "backlog", "task-backlog", "Platform", "p2"),
    ];
    writeClaim(projectDir, "task-pending", "run-pending", "pending-merge");

    const report = buildSupervisionLoadReport({
      projectDir,
      runsDir,
      runs: [],
      tasks,
      windowEndMs: NOW,
      reviewScrutiny: emptyAutonomyReportData.reviewScrutiny,
      postCompletionFollowUps: emptyAutonomyReportData.postCompletionFollowUps,
    });

    expect(report.counts.pendingMergeTaskClaims).toBe(1);
    expect(report.counts.blockedClaimRecoveries).toBe(1);
    expect(report.score.knownScore).toBe(5);
    expect(report.status).toBe("busy");
    expect(report.topReferences).toContainEqual(
      expect.objectContaining({
        kind: "task-claim",
        id: "task-pending:run-pending",
        reason: "pending-merge claim",
      }),
    );
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
    expect(report.counts.activeTaskClaims).toBeNull();
    expect(report.counts.pendingApprovals).toBeNull();
    expect(report.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "task-claims", status: "missing" }),
        expect.objectContaining({ source: "approvals", status: "unreadable" }),
        expect.objectContaining({ source: "dead-letters", status: "missing" }),
      ]),
    );
  });
});
