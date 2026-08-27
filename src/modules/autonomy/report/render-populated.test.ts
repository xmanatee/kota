import { describe, expect, it } from "vitest";
import type { AutonomyReportData } from "./aggregate.js";
import { renderReport } from "./render-test-helpers.js";
import { emptyAutonomyReportData as empty } from "./report-test-fixtures.js";

describe("renderAutonomyReport with populated data", () => {
  it("includes priority mix and explorer additions when populated", () => {
    const populated: AutonomyReportData = {
      ...empty,
      openQueue: {
        total: 3,
        byPriority: [
          { priority: "p1", count: 2 },
          { priority: "p2", count: 1 },
        ],
        byState: [
          { state: "open", count: 2 },
          { state: "open", count: 1 },
        ],
        waitingOnTasks: [
          {
            taskId: "task-waiting",
            title: "Waiting task",
            state: "open",
            waitingOn: ["task-enabler"],
          },
        ],
      },
      explorer: {
        totalRuns: 1,
        totalTaskAdditions: 2,
        unresolvedTaskAdditions: 0,
        taskAdditions: [
          {
            runId: "r1",
            taskId: "task-arch",
            title: "Strategic refactor",
            priority: "p1",
          },
          {
            runId: "r1",
            taskId: "task-client-fan",
            title: "Client surface",
            priority: "p2",
          },
        ],
      },
      builder: {
        totalCommittedRuns: 2,
        unresolvedClosures: 1,
        byPriority: [
          { priority: "p1", commits: 1, measuredCostRuns: 1, unavailableCostRuns: 0, unknownCostRuns: 0, totalCostUsd: 0.4 },
          { priority: "p2", commits: 1, measuredCostRuns: 1, unavailableCostRuns: 0, unknownCostRuns: 0, totalCostUsd: 0.1 },
        ],
        closures: [],
      },
      decisionAttribution: {
        totalRuns: 2,
        byPlanning: [
          { attribution: "owner", count: 1 },
          { attribution: "kota", count: 1 },
        ],
        byExecution: [{ attribution: "kota", count: 2 }],
        byWorkMode: [
          { workMode: "Product", count: 1 },
          { workMode: "Platform", count: 1 },
        ],
        hardSuccessSignals: [
          { signal: "committed-task-completion", count: 2 },
          { signal: "rendered-product-evidence", count: 1 },
        ],
        troubleSignals: [
          { signal: "weak-product-success-evidence", count: 1 },
        ],
        warnings: [
          {
            kind: "success-lacks-hard-evidence",
            count: 1,
            message:
              "Successful runs lacked hard success evidence or Product rendered evidence.",
            refs: ["run:r2", "task:task-product"],
          },
        ],
        records: [
          {
            runId: "r1",
            workflow: "builder",
            workMode: "Product",
            taskId: "task-product",
            taskTitle: "Product report",
            planning: "owner",
            planningContext: "owner-or-domain",
            execution: "kota",
            hardSuccessSignals: [
              "committed-task-completion",
              "rendered-product-evidence",
            ],
            troubleSignals: [],
            refs: ["run:r1", "task:task-product"],
          },
        ],
      },
      trajectoryDiagnostics: {
        activePatterns: [
          {
            workflow: "builder",
            stepId: "build",
            code: "missing_final_verification_after_edit",
            runCount: 3,
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
            activeFollowUpState: "open",
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
        byStatus: [{ status: "open", count: 1 }],
        topGroups: [
          {
            dedupeKey: "workflow:builder:runtime-warning",
            labels: ["runtime"],
            severity: "warning",
            actionability: "local-code",
            signalCount: 2,
            source: "workflow:builder",
            scope: "scope-a",
            status: "open",
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
        finishedRuns: 4,
        measuredRuns: 2,
        unavailableRuns: 1,
        unknownRuns: 1,
        averageMeasuredCostUsd: 0.25,
        byWorkflow: [
          {
            workflow: "builder",
            finishedRuns: 2,
            measuredRuns: 1,
            unavailableRuns: 1,
            unknownRuns: 0,
            totalCostUsd: 0.4,
            averageMeasuredCostUsd: 0.4,
          },
          {
            workflow: "explorer",
            finishedRuns: 2,
            measuredRuns: 1,
            unavailableRuns: 0,
            unknownRuns: 1,
            totalCostUsd: 0.1,
            averageMeasuredCostUsd: 0.1,
          },
        ],
      },
    };

    const text = renderReport(populated);
    expect(populated.cost).toMatchObject({
      measuredRuns: 2,
      unavailableRuns: 1,
      unknownRuns: 1,
    });
    expect(text).toContain("Total: 3");
    expect(text).toContain("Strategic refactor");
    expect(text).toContain("Client surface");
    expect(text).toContain("$0.40");
    expect(text).toContain("$0.10");
    expect(text).toContain("missing_final_verification_after_edit");
    expect(text).not.toContain("task-repair-trajectory-diagnostic-pattern");
    expect(text).toContain("task-review-follow-up");
    expect(text).toContain("workflow:builder:runtime-warning");
    expect(text).toContain("local-code");
    expect(text).toContain("owner-decision");
    expect(text).toContain("operator-capture");
    expect(text).toContain("task-waiting");
    expect(text).toContain("task-enabler");
    expect(text).toContain("could not be linked");
    expect(text).toContain("Decision attribution");
    expect(text).toContain("Planning attribution");
    expect(text).toContain("owner/kota");
    expect(text).toContain("rendered-product-evidence");
    expect(text).toContain("success-lacks-hard-evidence");
  });
});
