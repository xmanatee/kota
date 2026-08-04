import { GLOBAL_SCOPE_ID } from "#core/daemon/scope-registry.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HARNESS,
  stepCommitRequiresDaemonRestart,
  stepCommitted,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import { progressReviewRequested } from "./events.js";
import {
  decodeProgressReviewAgentOutput,
  PROGRESS_REVIEW_SCHEDULE_EVENT,
} from "./progress-review.js";
import { progressReviewOutputSchema } from "./workflow-output-schema.js";
import {
  agent,
  applyActions,
  collectEvidence,
  commitChanges,
  emptyActions,
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
    "Review bounded scoped activity evidence and create normal follow-up tasks or owner questions when steering is needed.",
  tags: ["progress-reviewer"],
  recoveryCapable: true,
  defaultAutonomyMode: "passive",
  triggers: [
    {
      event: progressReviewRequested.name,
      cooldownMs: 60_000,
    },
    {
      event: PROGRESS_REVIEW_SCHEDULE_EVENT,
      schedule: "0 */6 * * *",
      runOn: "default-scope",
      payload: { scopeId: GLOBAL_SCOPE_ID },
      cooldownMs: 60 * 60 * 1000,
    },
    {
      event: "workflow.completed",
      filter: { tags: ["monitored"] },
      batch: {
        maxCount: 5,
        maxAgeMs: 6 * 60 * 60 * 1000,
        groupBy: "projectId",
        maxBufferSize: 20,
        overflow: "flush-oldest",
      },
    },
    {
      event: "workflow.build.committed",
      batch: {
        maxCount: 3,
        maxAgeMs: 6 * 60 * 60 * 1000,
        groupBy: "projectId",
        maxBufferSize: 12,
        overflow: "flush-oldest",
      },
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
      run: ({ projectDir }) =>
        resetWorktreeForRecovery({
          projectDir,
          workflowName: "progress-reviewer",
        }),
    },
    inspectWorktree,
    collectEvidence,
    prepareReviewInput,
    {
      id: "review-evidence",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      harness: AUTONOMY_AGENT_HARNESS,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: agent.effort,
      timeoutMs: REVIEW_AGENT_TIMEOUT_MS,
      maxTurns: 8,
      outputFormat: "json",
      outputSchema: progressReviewOutputSchema,
      validate: decodeProgressReviewAgentOutput,
      when: (ctx) =>
        stepSucceeded("prepare-review-input")(ctx) &&
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
        return needsAttention(decodeProgressReviewAgentOutput(ctx.stepOutputs["review-evidence"]));
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
