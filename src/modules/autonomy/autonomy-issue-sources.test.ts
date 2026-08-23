import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import {
  readAutonomyIssueProjection,
  recordAutonomyIssueDispositions,
} from "./autonomy-issue-projection.js";
import { wireAutonomyIssueSourceFixture } from "./autonomy-issue-sources.test-helpers.js";
import { materializeGeneratedWorkProposal } from "./generated-work-proposal.js";
import type { AutonomyHealthSignal } from "./health-signal.js";
import {
  applyAutonomyHealthReviewActions,
  buildAutonomyHealthReviewFromSignals,
} from "./workflows/autonomy-health-reviewer/health-review.js";

const NOW = "2026-08-13T10:00:00.000Z";

describe("source-owned autonomy issue observations", () => {
  let projectDir: string;
  let pbus: ProjectScopedEventBus;
  let signals: AutonomyHealthSignal[];

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-issue-sources-"));
    ({ pbus, signals } = wireAutonomyIssueSourceFixture(projectDir));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("turns repeated run failures into one durable issue revision", () => {
    for (const runId of ["failure-run-1", "failure-run-2"]) {
      pbus.emit("workflow.failure.alert", {
        workflow: "builder",
        runId,
        status: "failed",
        durationMs: 1000,
        errorSummary: "Agent step build failed with code 17 at abcdef1234567",
        text: "builder failed",
      });
    }

    expect(signals).toHaveLength(2);
    expect(signals.map((signal) => signal.dedupeKey)).toEqual([
      signals[0]?.dedupeKey,
      signals[0]?.dedupeKey,
    ]);
    const actions = applyAutonomyHealthReviewActions({
      projectDir,
      review: buildAutonomyHealthReviewFromSignals({
        signals,
        generatedAt: NOW,
        sourceEventName: "fixture",
        reason: "fixture",
      }),
    });

    expect(actions.applied).toEqual([
      expect.objectContaining({ kind: "decision-requested", transition: "opened" }),
    ]);
    const issue = readAutonomyIssueProjection(projectDir).issues[0]!;
    expect(issue.semanticRevision).toBe(1);
    expect(issue.occurrenceCount).toBe(2);
    expect(issue.evidenceRefs).toHaveLength(2);
  });

  it("projects a generated owner answer back onto the linked durable issue", () => {
    pbus.emit("workflow.failure.alert", {
      workflow: "builder",
      runId: "owner-answer-failure",
      status: "failed",
      durationMs: 1000,
      errorSummary: "Builder needs an owner-selected recovery policy",
      text: "builder failed",
    });
    applyAutonomyHealthReviewActions({
      projectDir,
      review: buildAutonomyHealthReviewFromSignals({
        signals: [signals[0]!],
        generatedAt: NOW,
        sourceEventName: "workflow.failure.alert",
        reason: "fixture-open",
      }),
    });
    const issue = readAutonomyIssueProjection(projectDir).issues[0]!;
    const materialized = materializeGeneratedWorkProposal({
      projectDir,
      proposal: {
        kind: "owner-question",
        proposalKey: `autonomy-issue:${issue.issueKey}`,
        question: "Which recovery policy should builder implement?",
        reason: "Repository evidence cannot select the owner policy.",
        context: "Choose the policy for the linked autonomy issue.",
        proposedAnswers: ["Preserve work", "Release the claim"],
        provenance: {
          source: "improver",
          runId: "owner-question-disposition",
          issueKey: issue.issueKey,
          semanticRevision: issue.semanticRevision,
          evidenceRefs: issue.evidenceRefs.map((ref) => ref.ref),
        },
        origin: {
          kind: "workflow",
          workflowName: "improver",
          runId: "owner-question-disposition",
          stepId: "apply-disposition",
          taskId: null,
        },
      },
    });
    recordAutonomyIssueDispositions({
      projectDir,
      updates: [{
        issueKey: issue.issueKey,
        kind: "owner-question",
        decidedAt: NOW,
        taskIds: [],
        ownerQuestionIds: [materialized.ownerQuestionId!],
      }],
    });

    new OwnerQuestionQueue(
      join(projectDir, ".kota", "owner-questions"),
      pbus,
    ).answer(materialized.ownerQuestionId!, "Preserve work", "fixture-owner");
    const answerSignal = signals.at(-1)!;

    expect(answerSignal).toMatchObject({
      observation: "changed",
      dedupeKey: issue.rootCauseKey,
      source: issue.source,
    });
    const answered = applyAutonomyHealthReviewActions({
      projectDir,
      review: buildAutonomyHealthReviewFromSignals({
        signals: [answerSignal],
        generatedAt: answerSignal.createdAt,
        sourceEventName: "owner.question.changed",
        reason: "fixture-answer",
      }),
    });
    expect(answered.applied).toEqual([
      expect.objectContaining({
        issueKey: issue.issueKey,
        kind: "decision-requested",
        transition: "revised",
      }),
    ]);
    expect(readAutonomyIssueProjection(projectDir).issues).toEqual([
      expect.objectContaining({
        issueKey: issue.issueKey,
        rootCauseKey: issue.rootCauseKey,
        semanticRevision: 2,
        status: "needs-decision",
      }),
    ]);
  });

});
