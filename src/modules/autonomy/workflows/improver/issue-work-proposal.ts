import type { AutonomyIssue } from "#modules/autonomy/autonomy-issue-projection.js";
import {
  normalizeGeneratedTaskScalar,
  renderGeneratedTaskProse,
} from "#modules/autonomy/generated-task-text.js";
import type { GeneratedWorkProposal } from "#modules/autonomy/generated-work-proposal.js";
import type { IssueDisposition } from "./issue-disposition.js";

function issueTaskBody(
  issue: AutonomyIssue,
  disposition: IssueDisposition,
): string {
  const evidence = issue.evidenceRefs.map((ref) =>
    `- ${ref.kind}: ${ref.ref}${ref.summary ? ` — ${ref.summary}` : ""}`
  );
  return [
    "",
    "## Problem",
    "",
    renderGeneratedTaskProse(disposition.taskSummary),
    "",
    "## Desired Outcome",
    "",
    `Resolve autonomy issue ${issue.issueKey} at semantic revision ${issue.semanticRevision}.`,
    "",
    "## Constraints",
    "",
    "- Preserve the stable issue identity and cited provenance.",
    "- Implement through builder; this proposal is not evidence that the issue is fixed.",
    "",
    "## Done When",
    "",
    "- The issue's root cause is fixed or disproven with inspectable evidence.",
    "- A typed clear observation or explicit disposition resolves the durable issue.",
    "",
    "## Source / Intent",
    "",
    `Issue reviewer disposition: ${renderGeneratedTaskProse(disposition.rationale)}`,
    "",
    ...issue.summaries.map((summary) => `- ${summary}`),
    "",
    "Evidence:",
    "",
    ...evidence,
    "",
    ...(disposition.taskClass === "Meta"
      ? [
        "## Product / Safety Link",
        "",
        "This issue repair protects Product and Safety throughput by removing a durable autonomy failure or review gap before it consumes builder capacity.",
        "",
      ]
      : []),
    "## Initiative",
    "",
    "One autonomy issue, one decision, one implementation path.",
    "",
    "## Acceptance Evidence",
    "",
    `- ${renderGeneratedTaskProse(disposition.taskAcceptanceEvidence)}`,
    "",
  ].join("\n");
}

export function proposalFor(
  issue: AutonomyIssue,
  disposition: IssueDisposition,
  runId: string,
): GeneratedWorkProposal {
  const proposalKey = `autonomy-issue:${issue.issueKey}`;
  const provenance = {
    source: "improver",
    runId,
    issueKey: issue.issueKey,
    semanticRevision: issue.semanticRevision,
    evidenceRefs: issue.evidenceRefs.map((ref) => ref.ref),
  };
  if (disposition.action === "create-task") {
    return {
      kind: "task",
      proposalKey,
      title: normalizeGeneratedTaskScalar(
        "autonomy issue proposal",
        "title",
        disposition.taskTitle,
      ),
      summary: normalizeGeneratedTaskScalar(
        "autonomy issue proposal",
        "summary",
        disposition.taskSummary,
      ),
      priority: disposition.taskPriority,
      area: normalizeGeneratedTaskScalar(
        "autonomy issue proposal",
        "area",
        disposition.taskArea,
      ),
      taskClass: disposition.taskClass,
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
