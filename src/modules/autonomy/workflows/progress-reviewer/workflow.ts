import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_TIER,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import { taskQueueIntegrationPolicy } from "#modules/repo-tasks/task-integration-policy.js";
import {
  automaticProgressReviewRequested,
  progressReviewRequested,
} from "./events.js";
import { progressReviewNeedsAttention } from "./progress-review/actions.js";
import {
  decodeProgressReviewAgentOutput,
  validateProgressReviewAgentStepOutput,
} from "./progress-review.js";
import { admitProgressReviewTrigger } from "./semantic-input.js";
import { finalizeProgressReview } from "./semantic-publication.js";
import { progressReviewOutputSchema } from "./workflow-output-schema.js";
import {
  agent,
  applyActions,
  collectEvidence,
  emptyActions,
  inspectSemanticInput,
  prepareReviewInput,
  REVIEW_AGENT_TIMEOUT_MS,
  recordReviewRejection,
  writeArtifact,
  writeCommitMessage,
} from "./workflow-steps.js";

const progressReviewerWorkflow: WorkflowDefinitionInput = {
  name: "progress-reviewer",
  repository: "write",
  integration: taskQueueIntegrationPolicy(),
  finalize: finalizeProgressReview,
  description:
    "Review coalesced cross-run outcomes and follow systemic interventions through integration and later evidence.",
  tags: ["systemic-observer", "progress-reviewer"],
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
      tier: AUTONOMY_AGENT_TIER,
      effort: AUTONOMY_AGENT_DEFAULTS.effort,
      timeoutMs: REVIEW_AGENT_TIMEOUT_MS,
      outputFormat: "json",
      outputSchema: progressReviewOutputSchema,
      validate: validateProgressReviewAgentStepOutput,
      // Only output rejection is recoverable; the next step rethrows other failures.
      continueOnFailure: true,
      when: (ctx) =>
        stepSucceeded("prepare-review-input")(ctx) &&
        inspectSemanticInput.output(ctx)?.shouldReview === true,
    },
    recordReviewRejection,
    applyActions,
    writeArtifact,
    writeCommitMessage,
      {
      id: "emit-attention",
      type: "emit",
      when: (ctx) => {
        if (!stepSucceeded("write-artifact")(ctx)) return false;
        return progressReviewNeedsAttention(applyActions.output(ctx) ?? emptyActions());
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
