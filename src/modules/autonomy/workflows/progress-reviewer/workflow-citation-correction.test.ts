import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/index.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { resetModuleEventRegistry } from "#core/events/module-event.js";
import { executeWorkflowRun } from "#core/workflow/run-executor.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { DEFAULT_AGENT_STEP_RETRY } from "#core/workflow/steps/step-executor-retry.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";
import { progressReviewRequested } from "./events.js";
import type { ProgressReviewActionResult } from "./progress-review.js";
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

  it("fails closed with a retained diagnostic after repeated unknown evidence IDs", async () => {
    const workspaceRoot = makeScopeRoot("progress-reviewer-citation-exhausted");
    registerProgressReviewHarness(async () => {
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
      return {
        text: `Review complete.\n\`\`\`json\n${JSON.stringify(output)}\n\`\`\``,
        streamedText: "",
        turns: 1,
        usage: UNKNOWN_AGENT_USAGE,
        isError: false,
      };
    });
    const runId = "runtime-citation-exhausted";

    const result = await executeCitationReview(workspaceRoot, runId);

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
