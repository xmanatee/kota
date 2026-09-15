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
  inspectResearchRetryCandidatesOperation,
  markResearchRetryAttemptOperation,
} from "./blocking-operations.js";
import { availableResearchSourceTools, type MarkAttemptResult } from "./precondition.js";
import {
  createResearchRetryShadowReviewStep,
  type InspectResult,
} from "./shadow-review.js";
import { collectResearchSourceEvidence, type SourceEvidence, sourceEvidenceSchema } from "./source-evidence.js";
import { assertResearchRetryTrigger, RESEARCH_RETRY_EVENT } from "./trigger.js";

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
  rerunOnRetry: true,
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
  run: ({ workspaceRoot, scopeRoot, runBlocking, trigger, scopePolicySnapshot }) => {
    assertResearchRetryTrigger(trigger);
    return runBlocking(inspectResearchRetryCandidatesOperation, {
      workspaceRoot, scopeRoot,
      availableTools: availableResearchSourceTools(scopePolicySnapshot?.policy),
    });
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
  run: (ctx) => {
    const inspection = inspectCandidates.outputRequired(ctx);
    return collectResearchSourceEvidence({
      urls: inspection.candidate!.attemptableUrls,
      capability: inspection.capability,
      runTool: ctx.runTool,
    });
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
  integration: taskQueueIntegrationPolicy(),
  description:
    "Re-attempt inaccessible sources in blocked research tasks using the browser module's authenticated / rendered tools, then update task state honestly.",
  tags: ["monitored"],
  defaultAutonomyMode: "autonomous",
  triggers: [{ event: RESEARCH_RETRY_EVENT, cooldownMs: 60_000 }],
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
