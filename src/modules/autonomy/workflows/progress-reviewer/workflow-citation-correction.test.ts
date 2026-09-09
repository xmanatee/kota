import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/index.js";
import { OwnerDecisionStore } from "#core/daemon/owner-decision-store.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { resetModuleEventRegistry } from "#core/events/module-event.js";
import { executeWorkflowRun } from "#core/workflow/run-executor.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { DEFAULT_AGENT_STEP_RETRY } from "#core/workflow/steps/step-executor-retry.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";
import { inspectProgressSemanticBoundary } from "../dispatcher/semantic-reflection.js";
import { runGitEvidenceCommand } from "../git-evidence-test-support.js";
import { automaticProgressReviewRequested, progressReviewRequested } from "./events.js";
import type { ProgressReviewActionResult } from "./progress-review.js";
import { admitProgressReviewTrigger, PROGRESS_REVIEW_STATE_KEY, type ProgressReviewConsumptionState } from "./semantic-input.js";
import { emptyProgressReviewConsumptionState } from "./semantic-input-state.js";
import progressReviewerWorkflow from "./workflow.js";
import {
  commitProgressReviewFixture,
  compileProgressReviewerWorkflow,
  makeProgressReviewRunContext,
  makeProgressReviewScopeRoot,
  NOW,
  parseReviewInputFromAgentPrompt,
  registerProgressReviewHarness,
  reviewOutput,
  writeProgressReviewTask,
} from "./workflow.test-helpers.js";

const OBSERVED_UNKNOWN_EVIDENCE_IDS = [
  "dead-letter:dlq-f084687d-a51d-4b30-b661-aa07517a4d83",
  "scope:8nrg1m:dead-letter:dlq-f084687d-a51d-4b30-b661-aa07517a4d83",
] as const;

function executeCitationReview(workspaceRoot: string, runId: string) {
  const scopeId = deriveDirectoryScopeId(workspaceRoot);
  const definition = compileProgressReviewerWorkflow();
  const reviewStep = definition.steps.find((step) => step.id === "review-evidence");
  if (reviewStep?.type !== "agent") {
    throw new Error("review-evidence must be an agent step");
  }
  reviewStep.retry = {
    ...(reviewStep.retry ?? DEFAULT_AGENT_STEP_RETRY),
    initialDelayMs: 1,
  };
  return executeWorkflowRun(
    definition,
    {
      event: progressReviewRequested.name,
      schemaRef: null,
      payload: { scopeId, windowMs: 3_600_000 },
    },
    {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runContext: makeProgressReviewRunContext(workspaceRoot, runId),
      bus: new EventBus(),
      store: new WorkflowRunStore(workspaceRoot),
      log: vi.fn(),
    },
  ).promise;
}

describe("progress-reviewer citation correction", () => {
  const scopeRoots: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetModuleEventRegistry();
    for (const workspaceRoot of scopeRoots.splice(0)) {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  function makeScopeRoot(label: string): string {
    const workspaceRoot = makeProgressReviewScopeRoot(label);
    scopeRoots.push(workspaceRoot);
    writeProgressReviewTask(workspaceRoot, "open", "task-citation-source");
    commitProgressReviewFixture(
      workspaceRoot,
      "prepare citation fixture",
      "2026-06-04T11:30:00.000Z",
    );
    return workspaceRoot;
  }

  it("corrects schema-valid unknown evidence IDs before apply-actions", async () => {
    const workspaceRoot = makeScopeRoot("progress-reviewer-citation-correction");
    const exactEvidenceId = "task:task-citation-source";
    let attempts = 0;
    registerProgressReviewHarness(async (options) => {
      attempts += 1;
      const reviewInput = parseReviewInputFromAgentPrompt(options);
      expect(reviewInput.evidence.map((item) => item.id)).toContain(exactEvidenceId);
      const output = reviewOutput({
        verdict: "needs-steering",
        summary: "A cited follow-up needs a packet-bound evidence id.",
        localScope: {
          claims: attempts === 1 ? [] : [{
            id: "citation-contract-corrected",
            claim: "The corrected review uses an exact packet evidence id.",
            evidenceIds: [exactEvidenceId],
            confidence: "high",
          }],
          followUpTasks: attempts === 1 ? [{
            topicKey: "citation-contract-correction",
            title: "Do not apply the malformed cited follow-up",
            problem: "Unknown citations must be corrected before actions run.",
            priority: "p1",
            evidenceIds: [...OBSERVED_UNKNOWN_EVIDENCE_IDS],
            howWeWillKnow: "The corrected workflow run cites the packet.",
          }] : [],
        },
      });
      return {
        text: `Review complete.\n\`\`\`json\n${JSON.stringify(output)}\n\`\`\``,
        streamedText: "",
        turns: 1,
        usage: UNKNOWN_AGENT_USAGE,
        isError: false,
      };
    });

    const result = await executeCitationReview(
      workspaceRoot,
      "runtime-citation-correction",
    );

    expect(result.metadata.status).toBe("success");
    const review = result.metadata.steps.find((step) => step.id === "review-evidence");
    expect(review?.output).toEqual(expect.objectContaining({
      findings: expect.objectContaining({
        localScope: expect.objectContaining({
          claims: [expect.objectContaining({ evidenceIds: [exactEvidenceId] })],
        }),
      }),
    }));
    const actions = result.metadata.steps.find(
      (step) => step.id === "apply-actions",
    )?.output as ProgressReviewActionResult;
    expect(actions.createdTaskIds).toEqual([]);
    expect(actions.ownerQuestionIds).toEqual([]);
  });

  it("durably consumes exhausted automatic citations and admits later owner feedback after restart", async () => {
    const workspaceRoot = makeScopeRoot("progress-reviewer-citation-exhausted");
    const output = reviewOutput({
        verdict: "needs-steering",
        summary: "Malformed citations must not reach action writers.",
        localScope: { followUpTasks: [{
          topicKey: "citation-contract-exhausted",
          title: "Do not create this malformed follow-up",
          problem: "This action remains ungrounded after bounded correction.",
          priority: "p1",
          evidenceIds: [...OBSERVED_UNKNOWN_EVIDENCE_IDS],
          howWeWillKnow: "This malformed action is never applied.",
        }] },
        ownerQuestions: [{
          topicKey: "citation-contract-exhausted-question",
          question: "Do not enqueue this malformed owner question?",
          reason: "Its citations are not present in the packet.",
          evidenceIds: [...OBSERVED_UNKNOWN_EVIDENCE_IDS],
        }],
      });
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const stateDir = join(workspaceRoot, ".kota");
    const database = new RunStateDatabase(stateDir);
    database.registerScope({ id: scopeId, rootPath: workspaceRoot, createdAt: NOW.toISOString() });
    database.close();
    const state = createTestTransactionalRunState(join(stateDir, "review-state"), scopeId);
    const inspect = (boundary: unknown, consumedRevision: number) => inspectProgressSemanticBoundary({
      workspaceRoot, scopeRoot: workspaceRoot, stateDir,
      progressBoundaryState: boundary, consumedRevision, runCommand: runGitEvidenceCommand,
    });
    const baseline = await inspect(null, 0);
    writeProgressReviewTask(workspaceRoot, "blocked", "task-citation-source");
    commitProgressReviewFixture(workspaceRoot, "task needs external input", "2026-06-04T11:40:00.000Z");
    const reserved = await inspect(baseline.nextState, 0);
    expect(reserved.shouldEmit, reserved.reason).toBe(true);
    const trigger = { event: automaticProgressReviewRequested.name, schemaRef: null,
      payload: { scopeId, ...reserved.payload } };
    const definition = { ...progressReviewerWorkflow, steps: progressReviewerWorkflow.steps.map((step) =>
      step.type === "agent" ? { ...step, retry: { maxAttempts: 2, initialDelayMs: 1, backoffFactor: 1 } } : step) };
    const runId = "runtime-citation-exhausted";
    const run = await new WorkflowScenarioDriver(definition, {
      workspaceRoot, runId, trigger,
      ports: { state, runAgent: async () => output, runCommand: runGitEvidenceCommand },
    }).run();
    expect(run.status, run.error).toBe("success");
    const result = { metadata: new WorkflowRunStore(workspaceRoot).getRun(runId)! };
    const consumed = state.read<ProgressReviewConsumptionState>(PROGRESS_REVIEW_STATE_KEY).value!;
    expect(consumed).toEqual({ ...emptyProgressReviewConsumptionState(workspaceRoot), lastConsumedRevision: 1, consumedAt: NOW.toISOString() });
    expect(run.emitted).toEqual([]);
    const restartedBoundary = JSON.parse(JSON.stringify(reserved.nextState));
    expect(await inspect(restartedBoundary, consumed.lastConsumedRevision)).toMatchObject({ shouldEmit: false, nextState: { pending: null } });
    expect(admitProgressReviewTrigger({ scopeRoot: workspaceRoot, scopeId, stateDir, workflowName: "progress-reviewer", state, trigger })).toMatchObject({ admitted: false });
    const decisions = new OwnerDecisionStore(join(stateDir, "owner-decisions"), scopeId);
    const decision = decisions.create({
      request: { kind: "single-choice", prompt: "How should later evidence be assessed?", options: [{ id: "proceed", label: "Assess later evidence" }] },
      requester: { kind: "workflow", workflowName: "builder", runId: "later-owner-feedback", stepId: "ask", taskId: null },
      evidence: [],
    });
    decisions.answer(decision.id, { kind: "single-choice", optionId: "proceed" }, "operator");
    const later = await inspect(restartedBoundary, consumed.lastConsumedRevision);
    expect(later).toMatchObject({ shouldEmit: true, payload: { boundary: "owner-decision-resolution", inputRevision: 2 } });
    expect((await inspect(JSON.parse(JSON.stringify(later.nextState)), consumed.lastConsumedRevision)).shouldEmit).toBe(false);

    expect(result.metadata.status).toBe("completed-with-warnings");
    expect(result.metadata.steps.find((step) => step.id === "review-evidence"))
      .toMatchObject({ status: "failed", errorKind: "output-validation" });
    expect(result.metadata.steps.find((step) => step.id === "record-review-rejection")?.output)
      .toEqual({
        kind: "output-validation-exhausted",
        reason: expect.stringContaining(OBSERVED_UNKNOWN_EVIDENCE_IDS[0]),
        evidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
    expect(existsSync(join(
      workspaceRoot,
      "data/tasks/task-citation-contract-exhausted.md",
    ))).toBe(false);
    expect(existsSync(join(workspaceRoot, ".kota", "owner-questions"))).toBe(false);
    const retained = new WorkflowRunStore(workspaceRoot).getRun(runId);
    const diagnostic = JSON.stringify(retained);
    expect(diagnostic).toContain("unknown evidence id");
    expect(diagnostic).toContain(OBSERVED_UNKNOWN_EVIDENCE_IDS[0]);
    expect(diagnostic).toContain(OBSERVED_UNKNOWN_EVIDENCE_IDS[1]);
    expect(retained?.status).toBe("completed-with-warnings");
    expect(retained?.steps.find((step) => step.id === "review-evidence")?.errorKind)
      .toBe("output-validation");
  });

  it("keeps unrelated harness failures terminal instead of recording output rejection", async () => {
    const workspaceRoot = makeScopeRoot("progress-reviewer-runtime-failure");
    registerProgressReviewHarness(async () => {
      throw new Error("Reviewer harness execution failed");
    });

    const result = await executeCitationReview(workspaceRoot, "runtime-review-failure");

    expect(result.metadata.status).toBe("failed");
    expect(result.metadata.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ error: "Reviewer harness execution failed" }),
    ]));
    expect(existsSync(join(workspaceRoot, ".kota", "owner-questions"))).toBe(false);
  });
});
