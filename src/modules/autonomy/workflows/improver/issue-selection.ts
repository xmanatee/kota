import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import {
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import { autonomyIssueDecisionRequested } from "#modules/autonomy/autonomy-issue-events.js";
import {
  AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
  type AutonomyIssue,
  type AutonomyIssueProjection,
  decodeAutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";

export type IssueDecisionInput = {
  eligible: boolean;
  reason: string;
  issue: AutonomyIssue | null;
};

export function selectIssueForProjection(args: {
  trigger: WorkflowStepContext["trigger"];
  projection: AutonomyIssueProjection;
}): IssueDecisionInput {
  const { trigger, projection } = args;
  if (trigger.event !== autonomyIssueDecisionRequested.name) {
    return {
      eligible: false,
      reason: "recovery reconciles worktree state without replaying AI review",
      issue: null,
    };
  }
  const issueKey = trigger.payload.issueKey;
  const semanticRevision = trigger.payload.semanticRevision;
  if (typeof issueKey !== "string" || typeof semanticRevision !== "number") {
    throw new Error("autonomy issue decision trigger is malformed");
  }
  const issue = projection.issues.find(
    (candidate) => candidate.issueKey === issueKey,
  ) ?? null;
  if (!issue) {
    return { eligible: false, reason: "issue no longer exists", issue: null };
  }
  if (issue.semanticRevision !== semanticRevision) {
    return {
      eligible: false,
      reason: "issue advanced beyond the queued semantic revision",
      issue,
    };
  }
  if (
    issue.status === "resolved" ||
    issue.disposition.kind !== "needs-decision" ||
    issue.disposition.semanticRevision !== semanticRevision
  ) {
    return {
      eligible: false,
      reason: "issue revision already has a current disposition",
      issue,
    };
  }
  return {
    eligible: true,
    reason: "issue revision requires one disposition",
    issue,
  };
}

export function triggerIssue(
  ctx: Pick<WorkflowStepContext, "trigger" | "state">,
): IssueDecisionInput {
  const projection = decodeAutonomyIssueProjection(
    ctx.state.read<AutonomyIssueProjection>(
      AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
    ).value,
  );
  return selectIssueForProjection({ trigger: ctx.trigger, projection });
}

export const selectIssue = typedCodeStep<IssueDecisionInput>({
  id: "select-issue",
  type: "code",
  exposeOutputToAgent: true,
  validate: (raw) =>
    expectStructuredOutput<IssueDecisionInput>(raw, [
      "eligible",
      "reason",
      "issue",
    ]),
  run: triggerIssue,
});
