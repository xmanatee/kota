import { describe, expect, it } from "vitest";
import { renderReport, section } from "./render-test-helpers.js";
import { emptyAutonomyReportData as empty } from "./report-test-fixtures.js";

describe("renderAutonomyReport", () => {
  it("renders all dimension headings even when data is empty", () => {
    const text = renderReport(empty);
    expect(text).toContain("Autonomy report");
    expect(text).toContain("Supervision load");
    expect(text).toContain("Open queue");
    expect(text).toContain("Builder-completed tasks in window");
    expect(text).toContain("Explorer output");
    expect(text).toContain("Builder breakdown");
    expect(text).toContain("Decision attribution");
    expect(text).toContain("Diff-summary consistency");
    expect(text).toContain("Owner interventions");
    expect(text).toContain("Review scrutiny");
    expect(text).toContain("Trajectory diagnostics");
    expect(text).toContain("Process discipline");
    expect(text).toContain("Post-completion follow-ups");
    expect(text).toContain("Quality stratification");
    expect(text).toContain("Autonomy health");
    expect(text).toContain("Blockers");
    expect(text).toContain("Cost");
  });

  it("emits placeholder lines when sections are empty", () => {
    const text = renderReport(empty);
    expect(text).toContain("Status: normal");
    expect(text).toContain("active runs");
    expect(text).toContain("(no evidence sources checked)");
    expect(text).toContain("(none)");
    expect(text).toContain("(no explorer runs)");
    expect(text).toContain("(no builder commits)");
    expect(text).toContain("(no autonomy runs classified)");
    expect(text).toContain("(no builder runs inspected for diff-summary consistency)");
    expect(text).toContain("(no owner-question pressure)");
    expect(text).toContain("(no reviewer artifacts)");
    expect(text).toContain("(no recurring trajectory diagnostic patterns)");
    expect(text).toContain("(no process-discipline records)");
    expect(text).toContain(
      "(no corrective follow-ups linked to recently completed tasks)",
    );
    expect(text).toContain("(no quality signals with rate denominators)");
    expect(text).toContain("(no health signals)");
    expect(text).toContain("(no blocked tasks)");
    expect(text).toContain("(no finished runs in window)");
  });

  it("renders trajectory observations without prescribing repair work", () => {
    const text = renderReport({
      ...empty,
      trajectoryDiagnostics: {
        activePatterns: [
          {
            workflow: "explorer",
            stepId: "explore",
            code: "missing_final_verification_after_edit",
            runCount: 3,
            evidenceArtifactPaths: [
              ".kota/runs/r1/steps/explore.trajectory-diagnostics.json",
            ],
          },
        ],
      },
    });

    const trajectorySection = section(text, "Trajectory diagnostics", "Process discipline");
    expect(trajectorySection).toContain("explorer/explore");
    expect(trajectorySection).not.toContain("repair");
    expect(trajectorySection).not.toMatch(/\$|cost|throughput/i);
  });

  it("renders small-sample process-discipline groups without cost fields", () => {
    const text = renderReport({
      ...empty,
      processDiscipline: {
        rubricVersion: "process-discipline-v1",
        weakSampleThreshold: 3,
        totalRecords: 1,
        records: [],
        groups: [
          {
            dimension: "workflow",
            value: "builder",
            sampleCount: 1,
            averageScore: 75,
            gradeCounts: [{ grade: "caution", count: 1 }],
            weakSample: true,
            missingEvidenceDimensions: 1,
            unsupportedDimensions: 0,
            sourceArtifactPaths: [
              ".kota/runs/r1/steps/build.trajectory-diagnostics.json",
            ],
          },
        ],
      },
    });

    const processSection = section(
      text,
      "Process discipline",
      "Post-completion follow-ups",
    );
    expect(processSection).toContain("process-discipline-v1");
    expect(processSection).toContain("workflow/builder");
    expect(processSection).toContain("75/100");
    expect(processSection).toContain("weak sample");
    expect(processSection).toContain("missing=1");
    expect(processSection).not.toMatch(/\$|cost|throughput/i);
  });

  it("renders post-completion corrective follow-ups without cost fields", () => {
    const text = renderReport({
      ...empty,
      postCompletionFollowUps: {
        totalCorrectiveFollowUps: 1,
        linkedCompletedTaskCount: 1,
        byReason: [
          { reason: "ci-build-failure", count: 1 },
          { reason: "workflow-failure", count: 1 },
          { reason: "operator-report", count: 1 },
        ],
        completedTaskIds: ["task-completed-parent"],
        activeFollowUpTaskIds: ["task-workflow-failure-follow-up"],
        links: [
          {
            completedTaskId: "task-completed-parent",
            completedTaskTitle: "Completed parent",
            activeFollowUpTaskId: "task-workflow-failure-follow-up",
            activeFollowUpTitle: "Repair recurring workflow failure",
            activeFollowUpState: "open",
            reasons: ["ci-build-failure", "workflow-failure", "operator-report"],
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
    expect(followUpSection).toContain("task-workflow-failure-follow-up");
    expect(followUpSection).toContain("ci-build-failure");
    expect(followUpSection).toContain("workflow-failure");
    expect(followUpSection).not.toMatch(/\$|cost|throughput/i);
  });

});
