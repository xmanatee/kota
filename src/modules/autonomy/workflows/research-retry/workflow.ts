import type { AgentDef } from "#core/agents/agent-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { workflowCommandOutput } from "#core/workflow/workflow-command.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import {
  inspectResearchRetryCandidatesOperation,
  markResearchRetryAttemptOperation,
} from "./blocking-operations.js";
import type { MarkAttemptResult } from "./precondition.js";
import {
  createResearchRetryShadowReviewStep,
  type InspectResult,
} from "./shadow-review.js";

export const agent: AgentDef = {
  name: "research-retry",
  role:
    "Retry one blocked research task's inaccessible sources using authenticated-browser and rendered-browser tools, then update task state honestly.",
  promptPath: "src/modules/autonomy/workflows/research-retry/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  skills: [],
  writeScope: ["data/tasks/", "data/inbox/"],
};

const RESEARCH_RETRY_EVENT = "autonomy.blocked-research.attemptable";
const QUEUE_COUNT_KEYS = [
  "backlog",
  "ready",
  "doing",
  "blocked",
  "done",
  "dropped",
] as const;

function isNonNegativeInteger(
  value: WorkflowRunTrigger["payload"][string],
): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function hasValidQueueCounts(
  value: WorkflowRunTrigger["payload"][string],
): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    QUEUE_COUNT_KEYS.every((key) => isNonNegativeInteger(Reflect.get(value, key)))
  );
}

function assertResearchRetryTrigger(trigger: WorkflowRunTrigger): void {
  if (trigger.event !== RESEARCH_RETRY_EVENT) {
    throw new Error(`Research-retry accepts only ${RESEARCH_RETRY_EVENT} triggers`);
  }
  const { scopeId, candidateCount, attemptableCount, counts } = trigger.payload;
  if (
    typeof scopeId !== "string" ||
    scopeId.length === 0 ||
    !isNonNegativeInteger(candidateCount) ||
    !isNonNegativeInteger(attemptableCount) ||
    attemptableCount === 0 ||
    attemptableCount > candidateCount ||
    !hasValidQueueCounts(counts)
  ) {
    throw new Error(
      `Research-retry trigger payload must match ${RESEARCH_RETRY_EVENT}`,
    );
  }
}

const inspectCandidates = typedCodeStep<InspectResult>({
  id: "inspect-candidates",
  type: "code",
  exposeOutputToAgent: true,
  validate: (raw) =>
    expectStructuredOutput<InspectResult>(raw, [
      "dirty",
      "candidateCount",
      "capability",
      "candidate",
      "fingerprint",
      "marker",
      "examined",
    ]),
  run: ({ workspaceRoot, runBlocking, trigger }) => {
    assertResearchRetryTrigger(trigger);
    return runBlocking(inspectResearchRetryCandidatesOperation, { workspaceRoot });
  },
});

const markAttempt = typedCodeStep<MarkAttemptResult>({
  id: "mark-attempt",
  type: "code",
  when: stepSucceeded("retry"),
  validate: (raw): MarkAttemptResult => {
    const obj = expectStructuredOutput<{ written: boolean }>(raw, ["written"]);
    if (typeof obj.written !== "boolean") {
      throw new Error(`expected written: boolean, got ${typeof obj.written}`);
    }
    return raw as MarkAttemptResult;
  },
  run: (ctx) => {
    const inspection = inspectCandidates.outputRequired(ctx);
    if (!inspection.candidate) {
      return { written: false, reason: "no candidate selected" };
    }
    return ctx.runBlocking(markResearchRetryAttemptOperation, {
      workspaceRoot: ctx.workspaceRoot,
      candidateId: inspection.candidate.id,
    });
  },
});

const researchRetryShadowReview = createResearchRetryShadowReviewStep({
  inspectCandidates,
  markAttempt,
});

const researchRetryWorkflow: WorkflowDefinitionInput = {
  name: "research-retry",
  repository: "write",
  integration: { validationCommand: ["pnpm", "validate-tasks"] },
  description:
    "Re-attempt inaccessible sources in blocked research tasks using the browser module's authenticated / rendered tools, then update task state honestly.",
  tags: ["monitored"],
  defaultAutonomyMode: "autonomous",
  triggers: [{ event: RESEARCH_RETRY_EVENT, cooldownMs: 60_000 }],
  steps: [
    inspectCandidates,
    {
      id: "retry",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: AUTONOMY_AGENT_DEFAULTS.effort,
      timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
      when: (ctx) => {
        const inspection = inspectCandidates.outputRequired(ctx);
        return !inspection.dirty && inspection.candidate !== null;
      },
      repairLoop: {
        checks: [
          {
            id: "task-queue-valid",
            type: "code" as const,
            run: async (ctx) =>
              workflowCommandOutput(
                await ctx.runCommand({
                  command: "pnpm",
                  args: ["run", "validate-tasks"],
                  cwd: ctx.workspaceRoot,
                }),
              ),
          },
        ],
      },
    },
    markAttempt,
    researchRetryShadowReview,
  ],
};

export default researchRetryWorkflow;
