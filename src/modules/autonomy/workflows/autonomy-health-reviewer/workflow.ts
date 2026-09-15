import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { AUTONOMY_ISSUE_PROJECTION_RESOURCE, AUTONOMY_ISSUE_PROJECTION_STATE_KEY, type AutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.js";
import { autonomyHealthSignal } from "#modules/autonomy/health-signal.js";
import { type PrepareHealthReviewOutput, prepareAutonomyHealthReviewOperation } from "./action-operations.js";
import { finalizeAutonomyHealthReview } from "./health-review-finalization.js";

const prepareReview = typedCodeStep<PrepareHealthReviewOutput>({
  id: "prepare-review",
  type: "code",
  rerunOnRetry: true,
  validate: (raw) => expectStructuredOutput<PrepareHealthReviewOutput>(raw, ["artifactPath", "signalCount", "taskMutations"]),
  run: (ctx) => ctx.runBlocking(prepareAutonomyHealthReviewOperation, {
    workspaceRoot: ctx.workspaceRoot,
    runDirPath: ctx.workflow.runDirPath,
    currentProjection: ctx.state.read<AutonomyIssueProjection>(AUTONOMY_ISSUE_PROJECTION_STATE_KEY).value,
    triggerPayload: ctx.trigger.payload,
  }),
});

const autonomyHealthReviewerWorkflow: WorkflowDefinitionInput = {
  name: "autonomy-health-reviewer",
  repository: "read",
  finalize: finalizeAutonomyHealthReview,
  resources: () => [AUTONOMY_ISSUE_PROJECTION_RESOURCE],
  description:
    "Turn typed autonomy health observations into durable issue transitions and request review only for undecided revisions.",
  triggers: [
    {
      event: autonomyHealthSignal.name,
      filter: { severity: "info", observation: "cleared" },
      queueMode: "all",
    },
    {
      event: autonomyHealthSignal.name,
      filter: { severity: "critical" },
      queueMode: "all",
    },
    {
      event: autonomyHealthSignal.name,
      filter: { severity: ["warning", "error"] },
      batch: {
        pending: "coalesce",
        maxCount: 5,
        maxAgeMs: 60 * 60 * 1000,
        groupBy: ["scopeId", "dedupeKey"],
        maxBufferSize: 20,
        overflow: "flush-oldest",
      },
    },
  ],
  steps: [
    prepareReview,
    {
      id: "emit-task-mutations",
      type: "code",
      run: (ctx) => {
        const mutations = prepareReview.outputRequired(ctx).taskMutations;
        for (const [index, mutation] of mutations.entries()) {
          ctx.emit(
            "repo-task.mutation.requested",
            { request: { kind: "move", ...mutation } },
            {
              delivery: "on-run-success",
              stepId: `emit-task-mutation:${mutation.id}:${mutation.state}:${index}`,
            },
          );
        }
        return { emitted: mutations.length };
      },
    },
  ],
};

export default autonomyHealthReviewerWorkflow;
