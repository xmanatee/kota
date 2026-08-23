import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  onRecoveryTrigger,
  resetWorktreeForRecoveryOperation,
} from "#modules/autonomy/recovery.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  stepCommitRequiresDaemonRestart,
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
import { progressReviewOutputSchema } from "./workflow-output-schema.js";
import {
  agent,
  applyActions,
  collectEvidence,
  commitChanges,
  deferSemanticInput,
  emptyActions,
  inspectSemanticInput,
  inspectWorktree,
  needsAttention,
  prepareReviewInput,
  REVIEW_AGENT_TIMEOUT_MS,
  validateBeforeCommit,
  writeArtifact,
  writeCommitMessage,
} from "./workflow-steps.js";

const progressReviewerWorkflow: WorkflowDefinitionInput = {
  name: "progress-reviewer",
  description:
    "Review revisioned strategic boundaries against canonical scope state and reconcile normal steering work.",
  tags: ["progress-reviewer"],
  recoveryCapable: true,
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
    {
      event: "runtime.recovered",
    },
  ],
  steps: [
    {
      id: "reset-for-recovery",
      type: "code",
      when: onRecoveryTrigger,
      run: (ctx) =>
        ctx.runBlocking(resetWorktreeForRecoveryOperation, {
          projectDir: ctx.projectDir,
          workflowName: "progress-reviewer",
        }),
    },
    inspectSemanticInput,
    inspectWorktree,
    deferSemanticInput,
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
        inspectSemanticInput.output(ctx)?.shouldReview === true &&
        inspectWorktree.output(ctx)?.dirty === false,
    },
    applyActions,
    writeArtifact,
    writeCommitMessage,
    validateBeforeCommit,
    commitChanges,
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
    {
      id: "request-restart",
      type: "restart",
      when: stepCommitRequiresDaemonRestart("commit"),
      reason: "progress-reviewer committed progress review follow-up tasks",
      requires: ["commit"],
    },
  ],
};

export { agent, progressReviewOutputSchema };
export default progressReviewerWorkflow;
