import { describe, expect, it } from "vitest";
import type { AutonomyReportData } from "./aggregate.js";
import { renderReport, section } from "./render-test-helpers.js";
import { emptyAutonomyReportData as empty } from "./report-test-fixtures.js";

describe("renderAutonomyReport", () => {
  it("renders all dimension headings even when data is empty", () => {
    const text = renderReport(empty);
    expect(text).toContain("Autonomy report");
    expect(text).toContain("Open queue");
    expect(text).toContain("Tasks moved to done in window");
    expect(text).toContain("Explorer output");
    expect(text).toContain("Builder breakdown");
    expect(text).toContain("Diff-summary consistency");
    expect(text).toContain("Code-health drift");
    expect(text).toContain("Review scrutiny");
    expect(text).toContain("Review scrutiny escalation");
    expect(text).toContain("Trajectory diagnostics");
    expect(text).toContain("Post-completion follow-ups");
    expect(text).toContain("Quality stratification");
    expect(text).toContain("Autonomy health");
    expect(text).toContain("Blockers");
    expect(text).toContain("Cost");
  });

  it("emits placeholder lines when sections are empty", () => {
    const text = renderReport(empty);
    expect(text).toContain("(none)");
    expect(text).toContain("(no explorer runs)");
    expect(text).toContain("(no builder commits)");
    expect(text).toContain("(no builder runs inspected for diff-summary consistency)");
    expect(text).toContain("(no builder runs inspected for code-health drift)");
    expect(text).toContain("(no reviewer artifacts)");
    expect(text).toContain("(no recurring thin-acceptance patterns)");
    expect(text).toContain("(no recurring trajectory diagnostic patterns)");
    expect(text).toContain(
      "(no corrective follow-ups linked to recently completed tasks)",
    );
    expect(text).toContain("(no quality signals with rate denominators)");
    expect(text).toContain("(no health signals)");
    expect(text).toContain("(no blocked tasks)");
    expect(text).toContain("(no finished runs in window)");
  });

  it("renders trajectory repair task ids without cost fields in that section", () => {
    const text = renderReport({
      ...empty,
      trajectoryDiagnostics: {
        activePatterns: [
          {
            workflow: "explorer",
            stepId: "explore",
            code: "missing_final_verification_after_edit",
            runCount: 3,
            repairTaskId: "task-repair-trajectory-diagnostic-pattern-abc123def456",
            evidenceArtifactPaths: [
              ".kota/runs/r1/steps/explore.trajectory-diagnostics.json",
            ],
          },
        ],
      },
    });

    const trajectorySection = section(text, "Trajectory diagnostics", "Blockers");
    expect(trajectorySection).toContain("explorer/explore");
    expect(trajectorySection).toContain("task-repair-trajectory-diagnostic-pattern");
    expect(trajectorySection).not.toMatch(/\$|cost|throughput/i);
  });

  it("renders post-completion corrective follow-ups without cost fields", () => {
    const text = renderReport({
      ...empty,
      postCompletionFollowUps: {
        totalCorrectiveFollowUps: 1,
        linkedCompletedTaskCount: 1,
        byReason: [
          { reason: "ci-build-failure", count: 1 },
          { reason: "source-size", count: 1 },
          { reason: "operator-report", count: 1 },
        ],
        completedTaskIds: ["task-completed-parent"],
        activeFollowUpTaskIds: ["task-source-size-follow-up"],
        links: [
          {
            completedTaskId: "task-completed-parent",
            completedTaskTitle: "Completed parent",
            activeFollowUpTaskId: "task-source-size-follow-up",
            activeFollowUpTitle: "Split oversized source-size fallout",
            activeFollowUpState: "ready",
            reasons: ["ci-build-failure", "source-size", "operator-report"],
            matchedRefs: [
              "run:2026-04-28T09-00-00-000Z-builder-bbb",
              "git:commit:abc123def456",
            ],
            sourceRunIds: ["2026-04-28T09-00-00-000Z-builder-bbb"],
            sourceCommitRefs: ["abc123def456"],
            sourceArtifactPaths: [],
          },
        ],
        truncatedLinkCount: 0,
      },
    });

    const followUpSection = section(
      text,
      "Post-completion follow-ups",
      "Quality stratification",
    );
    expect(followUpSection).toContain("task-completed-parent");
    expect(followUpSection).toContain("task-source-size-follow-up");
    expect(followUpSection).toContain("ci-build-failure");
    expect(followUpSection).toContain("source-size");
    expect(followUpSection).not.toMatch(/\$|cost|throughput/i);
  });

  it("includes priority/area mix and explorer additions when populated", () => {
    const populated: AutonomyReportData = {
      ...empty,
      openQueue: {
        total: 3,
        byPriority: [
          { priority: "p1", count: 2 },
          { priority: "p2", count: 1 },
        ],
        byArea: [
          { area: "architecture", count: 2 },
          { area: "client", count: 1 },
        ],
        byState: [
          { state: "backlog", count: 2 },
          { state: "ready", count: 1 },
        ],
        byTaskClass: [
          { taskClass: "Product", count: 1 },
          { taskClass: "Platform", count: 1 },
          { taskClass: "Meta", count: 1 },
        ],
        waitingOnTasks: [
          {
            taskId: "task-waiting",
            title: "Waiting task",
            state: "ready",
            waitingOn: ["task-enabler"],
          },
        ],
      },
      explorer: {
        totalRuns: 1,
        totalTaskAdditions: 2,
        unresolvedTaskAdditions: 0,
        byClassification: [
          { classification: "strategic", tasks: 1 },
          { classification: "fan-out", tasks: 1 },
          { classification: "other", tasks: 0 },
        ],
        taskAdditions: [
          {
            runId: "r1",
            taskId: "task-arch",
            title: "Strategic refactor",
            area: "architecture",
            priority: "p1",
            classification: "strategic",
          },
          {
            runId: "r1",
            taskId: "task-client-fan",
            title: "Client surface",
            area: "client",
            priority: "p2",
            classification: "fan-out",
          },
        ],
      },
      builder: {
        totalCommittedRuns: 2,
        unresolvedClosures: 1,
        byArea: [
          { area: "architecture", commits: 1, totalCostUsd: 0.4 },
          { area: "client", commits: 1, totalCostUsd: 0.1 },
        ],
        byPriority: [
          { priority: "p1", commits: 1, totalCostUsd: 0.4 },
          { priority: "p2", commits: 1, totalCostUsd: 0.1 },
        ],
        byClassification: [
          { classification: "strategic", commits: 1, totalCostUsd: 0.4 },
          { classification: "fan-out", commits: 1, totalCostUsd: 0.1 },
          { classification: "other", commits: 0, totalCostUsd: 0 },
        ],
        closures: [],
      },
      trajectoryDiagnostics: {
        activePatterns: [
          {
            workflow: "builder",
            stepId: "build",
            code: "missing_final_verification_after_edit",
            runCount: 3,
            repairTaskId: "task-repair-trajectory-diagnostic-pattern-abc123def456",
            evidenceArtifactPaths: [
              ".kota/runs/r1/steps/build.trajectory-diagnostics.json",
            ],
          },
        ],
      },
      postCompletionFollowUps: {
        totalCorrectiveFollowUps: 1,
        linkedCompletedTaskCount: 1,
        byReason: [{ reason: "review-scrutiny", count: 1 }],
        completedTaskIds: ["task-review-parent"],
        activeFollowUpTaskIds: ["task-review-follow-up"],
        links: [
          {
            completedTaskId: "task-review-parent",
            completedTaskTitle: "Review parent",
            activeFollowUpTaskId: "task-review-follow-up",
            activeFollowUpTitle: "Repair review-scrutiny pattern",
            activeFollowUpState: "ready",
            reasons: ["review-scrutiny"],
            matchedRefs: ["task:task-review-parent"],
            sourceRunIds: [],
            sourceCommitRefs: [],
            sourceArtifactPaths: [],
          },
        ],
        truncatedLinkCount: 0,
      },
      health: {
        totalSignals: 2,
        totalGroups: 1,
        bySeverity: [{ severity: "warning", count: 2 }],
        byLabel: [{ label: "runtime", count: 2 }],
        byScope: [{ scope: "scope-a", count: 2 }],
        bySource: [{ source: "workflow:builder", count: 2 }],
        byActionability: [{ actionability: "local-code", count: 2 }],
        topGroups: [
          {
            dedupeKey: "workflow:builder:runtime-warning",
            labels: ["runtime"],
            severity: "warning",
            actionability: "local-code",
            signalCount: 2,
            source: "workflow:builder",
            scope: "scope-a",
          },
        ],
      },
      blockers: {
        totalBlocked: 2,
        byKind: [
          { kind: "owner-decision", count: 1 },
          { kind: "operator-capture", count: 1 },
        ],
      },
      cost: {
        totalCostUsd: 0.5,
        finishedRuns: 2,
        averagePerFinishedRun: 0.25,
        byWorkflow: [
          {
            workflow: "builder",
            finishedRuns: 1,
            totalCostUsd: 0.4,
            averageCostUsd: 0.4,
          },
          {
            workflow: "explorer",
            finishedRuns: 1,
            totalCostUsd: 0.1,
            averageCostUsd: 0.1,
          },
        ],
      },
    };

    const text = renderReport(populated);
    expect(text).toContain("Total: 3");
    expect(text).toContain("architecture");
    expect(text).toContain("client");
    expect(text).toContain("Strategic refactor");
    expect(text).toContain("Client surface");
    expect(text).toContain("By task_class");
    expect(text).toContain("Product");
    expect(text).toContain("Platform");
    expect(text).toContain("Meta");
    expect(text).toContain("$0.40");
    expect(text).toContain("$0.10");
    expect(text).toContain("missing_final_verification_after_edit");
    expect(text).toContain("task-repair-trajectory-diagnostic-pattern");
    expect(text).toContain("task-review-follow-up");
    expect(text).toContain("workflow:builder:runtime-warning");
    expect(text).toContain("local-code");
    expect(text).toContain("owner-decision");
    expect(text).toContain("operator-capture");
    expect(text).toContain("task-waiting");
    expect(text).toContain("task-enabler");
    expect(text).toContain("could not be linked");
  });
});
