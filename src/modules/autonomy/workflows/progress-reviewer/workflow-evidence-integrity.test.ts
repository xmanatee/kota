import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
import {
  PROGRESS_REVIEW_EVIDENCE_ARTIFACT,
  type ProgressReviewEvidencePacket,
} from "./progress-review.js";
import { agent } from "./workflow.js";
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

function executeReview(workspaceRoot: string, runId: string) {
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
      resolveAgentDef: (name) => name === agent.name ? agent : undefined,
    },
  ).promise;
}

describe("progress-reviewer evidence integrity", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    workspaceRoot = makeProgressReviewScopeRoot("progress-reviewer-forged-evidence");
    writeProgressReviewTask(workspaceRoot, "done", "task-citation-source");
    commitProgressReviewFixture(
      workspaceRoot,
      "prepare evidence-integrity fixture",
      "2026-06-04T11:30:00.000Z",
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    resetModuleEventRegistry();
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("binds runtime-authored evidence to its pre-agent digest", async () => {
    const runId = "runtime-forged-evidence";
    const forgedEvidenceId = "task:task-forged-agent-evidence";
    let attempts = 0;
    const receivedWriteScopes = [] as Array<typeof agent.writeScope | undefined>;
    const receivedOutputDirs: Array<string | undefined> = [];
    expect(agent.writeScope).toBe("deny-all");
    registerProgressReviewHarness(async (options) => {
      attempts += 1;
      receivedWriteScopes.push(options.agentWriteScope);
      receivedOutputDirs.push(options.agentOutputDir);
      const reviewInput = parseReviewInputFromAgentPrompt(options);
      expect(reviewInput.evidence.map((item) => item.id)).not.toContain(
        forgedEvidenceId,
      );
      const evidencePath = join(
        workspaceRoot,
        ".kota",
        "runs",
        runId,
        PROGRESS_REVIEW_EVIDENCE_ARTIFACT,
      );
      const evidence = JSON.parse(
        readFileSync(evidencePath, "utf-8"),
      ) as ProgressReviewEvidencePacket;
      if (!evidence.evidence.some((item) => item.id === forgedEvidenceId)) {
        evidence.evidence.push({
          id: forgedEvidenceId,
          kind: "task",
          summary: "Forged by the compromised review harness.",
        });
      }
      writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
      const output = reviewOutput({
        verdict: "needs-steering",
        summary: "Forged evidence must not authorize review actions.",
        localScope: {
          followUpTasks: [{
            topicKey: "forged-agent-evidence",
            title: "Do not create this forged follow-up",
            summary: "This task cites evidence added by the review agent.",
            priority: "p1",
            area: "security",
            evidenceIds: [forgedEvidenceId],
            howWeWillKnow: "The digest-bound review rejects this action.",
          }],
        },
        ownerQuestions: [{
          topicKey: "forged-agent-evidence-question",
          question: "Do not enqueue this forged owner question?",
          reason: "Its only citation was added by the review agent.",
          evidenceIds: [forgedEvidenceId],
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

    const result = await executeReview(workspaceRoot, runId);

    expect(result.metadata.status).toBe("failed");
    expect(attempts).toBe(2);
    expect(receivedWriteScopes).toEqual(["deny-all", "deny-all"]);
    expect(receivedOutputDirs).toEqual([
      join(workspaceRoot, ".kota", "runtime", runId, "agent"),
      join(workspaceRoot, ".kota", "runtime", runId, "agent"),
    ]);
    expect(result.metadata.steps.find((step) => step.id === "apply-actions"))
      .toBeUndefined();
    expect(
      readdirSync(join(workspaceRoot, "data", "tasks", "ready")).filter(
        (file) => file !== "AGENTS.md",
      ),
    ).toEqual([]);
    expect(existsSync(join(workspaceRoot, ".kota", "owner-questions"))).toBe(false);
    const diagnostic = readFileSync(
      join(workspaceRoot, ".kota", "runs", runId, "metadata.json"),
      "utf-8",
    );
    expect(diagnostic).toContain("evidence artifact digest mismatch");
  });
});
