import { describe, expect, it } from "vitest";
import { renderReport, section } from "./render-test-helpers.js";
import { emptyAutonomyReportData as empty } from "./report-test-fixtures.js";

describe("renderOwnerInterventions", () => {
  it("renders refs without raw prompts, answers, secrets, or cost fields", () => {
    const text = renderReport({
      ...empty,
      ownerInterventions: {
        totalQuestions: 1,
        pending: 0,
        stalePending: 0,
        answered: 1,
        answeredCorrections: 1,
        dismissed: 0,
        timeouts: 0,
        legacyUnknown: 0,
        byStatus: [{ status: "answered", count: 1 }],
        byOutcome: [{ outcome: "freeform-correction", count: 1 }],
        byAnswerBehavior: [{ answerBehavior: "workflow-resume", count: 1 }],
        bySource: [
          {
            key: "ask-owner",
            total: 1,
            stalePending: 0,
            timeouts: 0,
            answeredCorrections: 1,
          },
        ],
        byWorkflow: [
          {
            key: "builder",
            total: 1,
            stalePending: 0,
            timeouts: 0,
            answeredCorrections: 1,
          },
        ],
        byTask: [
          {
            key: "task-owner-intervention",
            total: 1,
            stalePending: 0,
            timeouts: 0,
            answeredCorrections: 1,
          },
        ],
        records: [
          {
            questionId: "q1",
            status: "answered",
            createdAt: "2026-04-29T10:00:00.000Z",
            resolvedAt: "2026-04-29T10:10:00.000Z",
            source: "ask-owner",
            originKind: "workflow",
            workflowName: "builder",
            runId: "run1",
            stepId: "build",
            taskId: "task-owner-intervention",
            answerBehavior: "workflow-resume",
            outcomeBucket: "freeform-correction",
            ageDays: 0,
            refs: {
              question: "owner-question:q1",
              workflow: "builder",
              run: "run:run1",
              task: "task:task-owner-intervention",
            },
            markers: [],
          },
        ],
      },
    });

    const interventionSection = section(
      text,
      "Owner interventions",
      "Review scrutiny",
    );
    expect(interventionSection).toContain("owner-question:q1");
    expect(interventionSection).toContain("task-owner-intervention");
    expect(interventionSection).toContain("freeform-correction");
    expect(interventionSection).not.toContain("sk-live-secret");
    expect(interventionSection).not.toContain("Which path should");
    expect(interventionSection).not.toMatch(/\$|cost|throughput/i);
  });
});
