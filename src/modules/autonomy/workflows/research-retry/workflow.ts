import type { AgentDef } from "#core/agents/agent-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { workflowCommandOutput } from "#core/workflow/workflow-command.js";
import {
  autonomyContinuationPolicy,
  workflowRunContinuationSubject,
} from "#modules/autonomy/continuation.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  AUTONOMY_AGENT_TIER,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import { taskQueueIntegrationPolicy, taskQueueValidationCommand } from "#modules/repo-tasks/task-integration-policy.js";
import {
  markResearchRetryAttemptOperation,
} from "./blocking-operations.js";
import { researchContractMatches, researchHandoffSchema, verifyResearchContract } from "./handoff.js";
import { computeResourceFingerprint, type MarkAttemptResult } from "./precondition.js";
import {
  createResearchRetryShadowReviewStep,
  type InspectResult,
} from "./shadow-review.js";
import { type SourceEvidence, sourceEvidenceSchema } from "./source-evidence.js";

export const agent: AgentDef = {
  name: "research-retry",
  role:
    "Assess workflow-collected source evidence for one blocked research task, then update task and inbox state honestly.",
  promptPath: "src/modules/autonomy/workflows/research-retry/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  skills: [],
  writeScope: ["data/tasks/", "data/inbox/"],
};

const inspectCandidates = typedCodeStep<InspectResult>({
  id: "inspect-candidates",
  type: "code",
  exposeOutputToAgent: true,
  exposedOutputTrust: "untrusted",
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
  run: ({ workspaceRoot, scopeId, trigger }) => {
    const handoff = researchHandoffSchema.parse(trigger.payload);
    if (trigger.payload.triggeredByRunId !== handoff.sourceRunId) throw new Error("Research evidence is not bound to its collecting parent run");
    if (handoff.scopeId !== scopeId) throw new Error("Research evidence belongs to another scope");
    return {
      dirty: false,
      candidateCount: 1,
      capability: handoff.capability,
      candidate: researchContractMatches(workspaceRoot, handoff) ? handoff.candidate : null,
      fingerprint: computeResourceFingerprint(handoff.candidate.urls),
      marker: null,
      examined: [],
    };
  },
});

const collectSources = typedCodeStep<SourceEvidence>({
  id: "collect-sources",
  type: "code",
  exposeOutputToAgent: true,
  exposedOutputTrust: "untrusted",
  validate: (raw) => sourceEvidenceSchema.parse(raw),
  when: (ctx) => {
    const inspection = inspectCandidates.outputRequired(ctx);
    return !inspection.dirty && inspection.candidate !== null;
  },
  run: (ctx) => researchHandoffSchema.parse(ctx.trigger.payload).evidence,
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
      attempts: collectSources.outputRequired(ctx).attempts,
    });
  },
});

const researchRetryShadowReview = createResearchRetryShadowReviewStep({
  inspectCandidates,
  collectSources,
  markAttempt,
});

const researchRetryWorkflow: WorkflowDefinitionInput = {
  name: "research-retry",
  repository: "write",
  resources: ({ trigger }) => [`task:${researchHandoffSchema.parse(trigger.payload).candidate.id}`],
  integration: taskQueueIntegrationPolicy({ postReconcile: verifyResearchContract }),
  description:
    "Review collected source evidence and publish task updates without performing external effects.",
  tags: ["monitored"],
  defaultAutonomyMode: "autonomous",
  triggers: [{ event: "workflow.triggered" }],
  steps: [
    inspectCandidates,
    collectSources,
    {
      id: "retry",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      tier: AUTONOMY_AGENT_TIER,
      effort: AUTONOMY_AGENT_DEFAULTS.effort,
      timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
      when: stepSucceeded("collect-sources"),
      repairLoop: {
        checks: [
          {
            id: "task-queue-valid",
            type: "code" as const,
            run: async (ctx) =>
              workflowCommandOutput(
                await ctx.runCommand({
                  command: taskQueueValidationCommand[0],
                  args: taskQueueValidationCommand.slice(1),
                  cwd: ctx.workspaceRoot,
                }),
              ),
          },
        ],
        continuation: autonomyContinuationPolicy({
          decompositionSupported: false,
          resolveSubject: (ctx) =>
            workflowRunContinuationSubject(ctx, {
              purpose:
                "Retry the selected blocked research source and update its task state honestly.",
              evidence: [{
                label: "Research candidate inspection",
                value: JSON.stringify(inspectCandidates.output(ctx) ?? null),
              }],
            }),
        }),
      },
    },
    markAttempt,
    researchRetryShadowReview,
  ],
};

export default researchRetryWorkflow;
