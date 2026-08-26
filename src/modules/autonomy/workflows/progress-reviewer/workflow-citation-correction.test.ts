import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/index.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { resetModuleEventRegistry } from "#core/events/module-event.js";
import { executeWorkflowRun } from "#core/workflow/run-executor.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
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
  reviewStep.retry = { maxAttempts: 2, initialDelayMs: 1, backoffFactor: 1 };
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
    vi.clearAllMocks();
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
    writeProgressReviewTask(workspaceRoot, "done", "task-citation-source");
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
    const prompts: string[] = [];
    registerProgressReviewHarness(async (options) => {
      attempts += 1;
      prompts.push(options.prompt);
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
            summary: "Unknown citations must be corrected before actions run.",
            priority: "p1",
            area: "autonomy",
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
    expect(attempts).toBe(2);
    expect(prompts[1]).toContain("Previous structured output failed workflow validation");
    expect(prompts[1]).toContain(OBSERVED_UNKNOWN_EVIDENCE_IDS[0]);
    expect(prompts[1]).toContain(OBSERVED_UNKNOWN_EVIDENCE_IDS[1]);
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
    let attempts = 0;
    registerProgressReviewHarness(async () => {
      attempts += 1;
      const output = reviewOutput({
        verdict: "needs-steering",
        summary: "Malformed citations must not reach action writers.",
        localScope: { followUpTasks: [{
          topicKey: "citation-contract-exhausted",
          title: "Do not create this malformed follow-up",
          summary: "This action remains ungrounded after bounded correction.",
          priority: "p1",
          area: "autonomy",
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

    expect(result.metadata.status).toBe("failed");
    expect(attempts).toBe(2);
    expect(result.metadata.steps.find((step) => step.id === "apply-actions"))
      .toBeUndefined();
    expect(existsSync(join(
      workspaceRoot,
      "data/tasks/ready/task-citation-contract-exhausted.md",
    ))).toBe(false);
    expect(existsSync(join(workspaceRoot, ".kota", "owner-questions"))).toBe(false);
    const diagnostic = readFileSync(
      join(workspaceRoot, ".kota", "runs", runId, "metadata.json"),
      "utf-8",
    );
    expect(diagnostic).toContain("unknown evidence id");
    expect(diagnostic).toContain(OBSERVED_UNKNOWN_EVIDENCE_IDS[0]);
    expect(diagnostic).toContain(OBSERVED_UNKNOWN_EVIDENCE_IDS[1]);
  });
});
