import { describe, expect, it } from "vitest";
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
    expect(text).toContain("Decision attribution");
    expect(text).toContain("Diff-summary consistency");
    expect(text).toContain("Code-health drift");
    expect(text).toContain("Owner interventions");
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
    expect(text).toContain("(no autonomy runs classified)");
    expect(text).toContain("(no builder runs inspected for diff-summary consistency)");
    expect(text).toContain("(no builder runs inspected for code-health drift)");
    expect(text).toContain("(no owner-question pressure)");
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

});
