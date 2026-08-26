import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import {
  automaticProgressReviewRequested,
  progressReviewRequested,
} from "./events.js";
import {
  decodeProgressReviewAgentOutput,
  validateProgressReviewAgentStepOutput,
} from "./progress-review.js";
import { admitProgressReviewTrigger } from "./semantic-input.js";
import {
  PROGRESS_REVIEW_PUBLICATION_REQUESTED_EVENT,
  progressReviewPublicationKey,
} from "./semantic-publication.js";
import { progressReviewOutputSchema } from "./workflow-output-schema.js";
import {
  agent,
  applyActions,
  collectEvidence,
  emptyActions,
  inspectSemanticInput,
  needsAttention,
  prepareReviewInput,
  REVIEW_AGENT_TIMEOUT_MS,
  validateChanges,
  writeArtifact,
  writeCommitMessage,
} from "./workflow-steps.js";

const progressReviewerWorkflow: WorkflowDefinitionInput = {
  name: "progress-reviewer",
  repository: "write",
  integration: { validationCommand: ["pnpm", "validate-tasks"] },
  description:
    "Review revisioned strategic boundaries against canonical scope state and reconcile normal steering work.",
  tags: ["progress-reviewer"],
  // Capable-tier presets may resolve to a native CLI harness. The reviewer is
  // bounded by its projected AgentDef writeScope plus the post-step mutation
  // check.
  defaultAutonomyMode: "autonomous",
  triggerAdmission: admitProgressReviewTrigger,
  triggers: [
    {
      event: progressReviewRequested.name,
      cooldownMs: 0,
      queueMode: "all",
    },
    {
      event: automaticProgressReviewRequested.name,
      cooldownMs: 0,
      queueMode: "latest",
    },
  ],
  steps: [
    inspectSemanticInput,
    collectEvidence,
    prepareReviewInput,
    {
      id: "review-evidence",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: AUTONOMY_AGENT_DEFAULTS.effort,
      timeoutMs: REVIEW_AGENT_TIMEOUT_MS,
      maxTurns: 8,
      outputFormat: "json",
      outputSchema: progressReviewOutputSchema,
      validate: validateProgressReviewAgentStepOutput,
      when: (ctx) =>
        stepSucceeded("prepare-review-input")(ctx) &&
        inspectSemanticInput.output(ctx)?.shouldReview === true,
    },
    applyActions,
    writeArtifact,
    writeCommitMessage,
    validateChanges,
    {
      id: "emit-progress-publication",
      type: "emit",
      when: stepSucceeded("write-artifact"),
      event: PROGRESS_REVIEW_PUBLICATION_REQUESTED_EVENT,
      payload: (ctx) => {
        const publicationKey = progressReviewPublicationKey(ctx.workflow.runId);
        return {
          idempotencyKey: publicationKey,
          publicationKey,
          sourceRunId: ctx.workflow.runId,
        };
      },
    },
    {
      id: "emit-attention",
      type: "emit",
      when: (ctx) => {
        if (!stepSucceeded("write-artifact")(ctx)) return false;
        return needsAttention(applyActions.output(ctx) ?? emptyActions());
      },
      event: "workflow.attention.digest",
      payload: (ctx) => {
        const review = decodeProgressReviewAgentOutput(ctx.stepOutputs["review-evidence"]);
        const actions = applyActions.output(ctx) ?? emptyActions();
        return {
          items: [
            {
              label: "Progress review",
              detail: `${review.verdict}: ${review.summary}`,
            },
          ],
          text:
            `Progress review ${review.verdict}: ${review.summary}\n` +
            `Follow-up tasks: ${actions.createdTaskIds.join(", ") || "none"}\n` +
            `Owner questions: ${actions.ownerQuestionIds.join(", ") || "none"}`,
        };
      },
    },
  ],
};

export { agent, progressReviewOutputSchema };
export default progressReviewerWorkflow;
