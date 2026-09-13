import type { AutonomyIssue } from "#modules/autonomy/autonomy-issue-projection.js";
import {
  normalizeGeneratedTaskScalar,
  renderGeneratedTaskProse,
} from "#modules/autonomy/generated-task-text.js";
import type { GeneratedWorkProposal } from "#modules/autonomy/generated-work-proposal.js";
import { renderRepoTaskIntent } from "#modules/repo-tasks/repo-task-intent.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import type { IssueDisposition } from "./issue-disposition.js";

function issueTaskBody(
  issue: AutonomyIssue,
  disposition: IssueDisposition,
): string {
  const evidence = issue.evidenceRefs.map((ref) =>
    `- ${ref.kind}: ${ref.ref}${ref.summary ? ` — ${ref.summary}` : ""}`
  );
  return renderRepoTaskIntent({
    problem: issue.summaries.map(renderGeneratedTaskProse).join("\n\n"),
    desiredOutcome: renderGeneratedTaskProse(disposition.taskDesiredOutcome),
    constraints: [
      "- Preserve the stable issue identity and cited provenance.",
      "- Implement through builder; this proposal is not evidence that the issue is fixed.",
    ].join("\n"),
    howWeWillKnow: renderGeneratedTaskProse(disposition.taskHowWeWillKnow),
    context: [
      `Issue reviewer disposition: ${renderGeneratedTaskProse(disposition.rationale)}`,
      "",
      "Evidence:",
      "",
      ...evidence,
    ].join("\n"),
  });
}

export function proposalFor(
  issue: AutonomyIssue,
  disposition: IssueDisposition,
  runId: string,
  workspaceRoot: string,
): GeneratedWorkProposal {
  const proposalKey = `autonomy-issue:${issue.issueKey}`;
  const provenance = {
    source: "improver",
    runId,
    issueKey: issue.issueKey,
    semanticRevision: issue.semanticRevision,
    evidenceRefs: issue.evidenceRefs.map((ref) => ref.ref),
  };
  if (disposition.action === "link-task") {
    const task = listFullRepoTasks(workspaceRoot).find((candidate) => candidate.id === disposition.existingTaskId);
    if (!task || task.state === "dropped") {
      throw new Error(`Existing repair task ${disposition.existingTaskId} is missing or dropped in this scope`);
    }
    return { kind: "existing-task", proposalKey, taskId: task.id, reviewedBody: task.body, provenance };
  }
  if (disposition.action === "create-task") {
    return {
      kind: "task",
      proposalKey,
      title: normalizeGeneratedTaskScalar(
        "autonomy issue proposal",
        "title",
        disposition.taskTitle,
      ),
      priority: disposition.taskPriority,
      body: issueTaskBody(issue, disposition),
      provenance,
    };
  }
  if (disposition.action === "ask-owner") {
    return {
      kind: "owner-question",
      proposalKey,
      question: disposition.ownerQuestion,
      reason: disposition.ownerReason,
      context:
        `${disposition.rationale}\n\nIssue ${issue.issueKey} revision ${issue.semanticRevision}.`,
      proposedAnswers: disposition.proposedAnswers,
      provenance,
      origin: {
        kind: "workflow",
        workflowName: "improver",
        runId,
        stepId: "apply-disposition",
        taskId: null,
      },
    };
  }
  return {
    kind: "none",
    proposalKey,
    reason: disposition.rationale,
    source: "improver",
  };
}
