import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkflowDispatchDeadLetter } from "#core/daemon/dead-letter-queue.js";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import type { ScopeRuntime } from "#core/daemon/scope-runtime.js";
import type { ScopedEventBus } from "#core/events/scope.js";
import {
  materializeAutonomyIssueProjection,
  readAutonomyIssueProjection,
  recordAutonomyIssueDispositions,
} from "./autonomy-issue-projection.js";
import {
  applyHealthReviewSignals,
  ISSUE_SOURCE_SCOPE_ID,
  wireAutonomyIssueSourceFixture,
} from "./autonomy-issue-sources.test-helpers.js";
import { materializeGeneratedWorkProposal } from "./generated-work-proposal.js";
import {
  type AutonomyHealthSignal,
  normalizeHealthSignal,
} from "./health-signal.js";

const NOW = "2026-08-13T10:00:00.000Z";

describe("source-owned autonomy issue observations", () => {
  let workspaceRoot: string;
  let pbus: ScopedEventBus;
  let runtime: ScopeRuntime;
  let signals: AutonomyHealthSignal[];

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "kota-issue-sources-"));
    ({ pbus, runtime, signals } = wireAutonomyIssueSourceFixture(workspaceRoot));
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("derives a failed workflow issue only from its durable dead letter", () => {
    pbus.emit("workflow.failure.alert", {
      workflow: "builder",
      runId: "failure-run-1",
      status: "failed",
      durationMs: 1000,
      errorSummary: "Agent step build failed with code 17",
      text: "builder failed",
    });

    expect(signals).toEqual([]);

    createWorkflowDispatchDeadLetter({
      store: runtime.deadLetterQueue,
      scopeId: ISSUE_SOURCE_SCOPE_ID,
      workflowName: "builder",
      trigger: {
        event: "repo-task.changed",
        schemaRef: null,
        payload: {},
      },
      reason: "Agent step build failed with code 17",
      errorClass: "execution",
      failedRun: {
        id: "failure-run-1",
        workflow: "builder",
        definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
        trigger: {
          event: "repo-task.changed",
          schemaRef: null,
          payload: {},
        },
        startedAt: NOW,
        completedAt: NOW,
        status: "failed",
        runDir: ".kota/runs/failure-run-1",
        steps: [],
      },
    });

    expect(signals).toEqual([
      expect.objectContaining({
        observation: "present",
        source: expect.objectContaining({ id: "builder" }),
        evidenceRefs: [expect.objectContaining({ kind: "dead-letter" })],
      }),
    ]);
  });

  it("projects a generated owner answer back onto the linked durable issue", () => {
    const openingSignal = normalizeHealthSignal({
      observation: "present",
      source: { kind: "workflow", id: "builder", workflow: "builder" },
      severity: "critical",
      labels: ["runtime", "workflow-failure"],
      summary: "Builder needs an owner-selected recovery policy",
      evidenceRefs: [{
        kind: "dead-letter",
        ref: ".kota/dead-letter-queue/items.json#owner-answer-failure",
      }],
      actionability: "local-code",
      dedupeKey: "workflow:builder:failure:owner-policy",
      observationCount: 1,
      createdAt: NOW,
    });
    applyHealthReviewSignals({
      workspaceRoot,
      signals: [openingSignal],
      generatedAt: NOW,
      reason: "fixture-open",
    });
    const issue = readAutonomyIssueProjection(workspaceRoot).issues[0]!;
    const materialized = materializeGeneratedWorkProposal({
      workspaceRoot,
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
    materializeAutonomyIssueProjection(workspaceRoot, recordAutonomyIssueDispositions({
      current: readAutonomyIssueProjection(workspaceRoot),
      updates: [{
        issueKey: issue.issueKey,
        kind: "owner-question",
        decidedAt: NOW,
        taskIds: [],
        ownerQuestionIds: [materialized.ownerQuestionId!],
      }],
    }));

    new OwnerQuestionQueue(
      join(workspaceRoot, ".kota", "owner-questions"),
      pbus,
    ).answer(materialized.ownerQuestionId!, "Preserve work", "fixture-owner");
    const answerSignal = signals.at(-1)!;

    expect(answerSignal).toMatchObject({
      observation: "changed",
      dedupeKey: issue.rootCauseKey,
      source: issue.source,
    });
    const answered = applyHealthReviewSignals({
      workspaceRoot,
      signals: [answerSignal],
      generatedAt: answerSignal.createdAt,
      reason: "fixture-answer",
    });
    expect(answered.applied).toEqual([
      expect.objectContaining({
        issueKey: issue.issueKey,
        kind: "decision-requested",
        transition: "revised",
      }),
    ]);
    expect(readAutonomyIssueProjection(workspaceRoot).issues).toEqual([
      expect.objectContaining({
        issueKey: issue.issueKey,
        rootCauseKey: issue.rootCauseKey,
        semanticRevision: 2,
        status: "needs-decision",
      }),
    ]);
  });

});
