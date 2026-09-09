import { stageGeneratedWorkProposal } from "#modules/autonomy/generated-work-proposal.js";
import { findGeneratedWorkTask } from "#modules/autonomy/generated-work-task.js";
import { renderRepoTaskIntent } from "#modules/repo-tasks/repo-task-intent.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import type { GardenerDecision } from "./decision.js";

export function stageGardenerTask(args: {
  workspaceRoot: string;
  runId: string;
  decision: GardenerDecision;
}): { taskId: string | null; proposalKey: string | null; touchedTaskQueue: boolean } {
  const { decision } = args;
  if (decision.action === "covered") {
    if (!listFullRepoTasks(args.workspaceRoot).some((t) => t.id === decision.existingTaskId)) {
      throw new Error(`Gardener cited a missing task: ${decision.existingTaskId}`);
    }
    return { taskId: decision.existingTaskId, proposalKey: null, touchedTaskQueue: false };
  }
  const proposal = decision.proposal;
  if (!proposal) return { taskId: null, proposalKey: null, touchedTaskQueue: false };
  const proposalKey = `architecture-gardener:${proposal.mechanismKey}`;
  const existing = findGeneratedWorkTask(args.workspaceRoot, proposalKey);
  if (existing) {
    // Existing builders (including retained writers) keep their task contracts.
    // Completed work is inspected by the investigator, never blindly reopened.
    return { taskId: existing.task.id, proposalKey, touchedTaskQueue: false };
  }
  const body = renderRepoTaskIntent({
    problem: `${proposal.problem}\n\nInvestigation: ${decision.rationale}\n\nEvidence:\n${decision.evidenceRefs.map((ref) => `- ${ref}`).join("\n")}`,
    desiredOutcome: [
      `${proposal.expectedOutcome}\n\nThis is an unverified expectation, not a measured improvement.`,
      `Maintained consumers:\n${proposal.consumers.map((c) => `- ${c}`).join("\n")}`,
      `Alternatives considered:\n${proposal.alternatives.map((a) => `- ${a}`).join("\n")}`,
      `Migration and retirement: ${proposal.migrationAndRetirement}`,
      ...(proposal.abstraction ? [
        `Common behavior: ${proposal.abstraction.commonBehavior}\nStable variation point: ${proposal.abstraction.variationPoint}\nCanonical owner: ${proposal.abstraction.canonicalOwner}`,
      ] : []),
    ].join("\n\n"),
    constraints: "Preserve domain-specific behavior. Migrate real callers and retire replaced paths; avoid permanent dual ownership. Select proportionate proof under Standards at authoritative consumer boundaries; retain distinct public-behavior and security checks while retiring redundant proofs. File size, clone count and LOC are diagnostic, not acceptance gates.",
    howWeWillKnow: `${proposal.preservationEvidenceNeeded}\n\n${proposal.simplificationEvidenceNeeded}\n\nRecord actual migrated callers, retired paths and the simpler result in this task's completion evidence. The gardener follows this task; expected benefits alone do not establish success.`,
  });
  const staged = stageGeneratedWorkProposal({
    workspaceRoot: args.workspaceRoot,
    proposal: {
      kind: "task", proposalKey, title: proposal.title, priority: "p1", body,
      provenance: { source: "architecture-gardener", runId: args.runId, evidenceRefs: decision.evidenceRefs },
    },
  });
  return { taskId: staged.taskId, proposalKey, touchedTaskQueue: staged.touchedTaskQueue };
}
