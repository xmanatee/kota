import type { RunEvidenceReader } from "#core/workflow/run-context.js";
import type { GeneratedWorkTaskProposal, StagedGeneratedWorkProposalResult } from "#modules/autonomy/generated-work-proposal.js";
import { normalizeGeneratedWorkProposalKey, stageGeneratedWorkProposal } from "#modules/autonomy/generated-work-proposal.js";
import { findGeneratedWorkTask } from "#modules/autonomy/generated-work-task.js";
import { renderRepoTaskIntent } from "#modules/repo-tasks/repo-task-intent.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import type { GardenerDecision } from "./decision.js";

/** The runtime projects current requested/retained resources; terminal runs have none. */
export function readHeldTaskIds(reader: RunEvidenceReader | undefined, runId: string): string[] | null {
  return reader ? reader.listRuns().filter((run) => run.id !== runId)
    .flatMap((run) => run.resources.filter((key) => key.startsWith("task:")).map((key) => key.slice(5))) : null;
}

export function stageGardenerTask(args: {
  topicKey?: string;
  workspaceRoot: string;
  runId: string;
  decision: GardenerDecision;
  heldTaskIds: readonly string[] | null;
}): { taskId: string | null; proposalKey: string | null; touchedTaskQueue: boolean; disposition: "proposed" | "covered" | "no-action" | "deferred"; actions: StagedGeneratedWorkProposalResult["actions"]; proposal: GeneratedWorkTaskProposal | null } {
  const { decision } = args;
  if (decision.action === "covered") {
    if (!listFullRepoTasks(args.workspaceRoot).some((t) => t.id === decision.existingTaskId)) {
      throw new Error(`Gardener cited a missing task: ${decision.existingTaskId}`);
    }
    return { taskId: decision.existingTaskId, proposalKey: null, touchedTaskQueue: false, disposition: "covered", actions: [], proposal: null };
  }
  const proposal = decision.proposal;
  if (!proposal) return { taskId: null, proposalKey: null, touchedTaskQueue: false, disposition: "no-action", actions: [], proposal: null };
  const proposalKey = args.topicKey
    ? normalizeGeneratedWorkProposalKey(args.topicKey)
    : `architecture-gardener:${proposal.mechanismKey}`;
  const existing = findGeneratedWorkTask(args.workspaceRoot, proposalKey);
  if (args.heldTaskIds === null || (existing &&
    (existing.task.state === "open" || existing.task.state === "blocked" || args.heldTaskIds.includes(existing.task.id)))) {
    // Active task intent remains with its builder; terminal work may be reopened
    // only after runtime ownership is available and no retained writer holds it.
    return { taskId: existing?.task.id ?? null, proposalKey, touchedTaskQueue: false,
      disposition: "deferred", actions: [], proposal: null };
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
    constraints: "Preserve the maintained consumers' domain-specific behavior.",
    howWeWillKnow: `${proposal.preservationEvidenceNeeded}\n\n${proposal.simplificationEvidenceNeeded}\n\nRecord actual migrated callers, retired paths and the simpler result in this task's completion evidence. The gardener follows this task; expected benefits alone do not establish success.`,
  });
  const taskProposal: GeneratedWorkTaskProposal = {
    kind: "task", proposalKey, title: proposal.title, priority: proposal.priority, body,
    provenance: { source: "architecture-gardener", runId: args.runId, evidenceRefs: decision.evidenceRefs },
  };
  const staged = stageGeneratedWorkProposal({ workspaceRoot: args.workspaceRoot, proposal: taskProposal });
  return { taskId: staged.taskId, proposalKey, touchedTaskQueue: staged.touchedTaskQueue,
    disposition: staged.touchedTaskQueue ? "proposed" : "covered",
    actions: staged.actions, proposal: taskProposal,
  };
}
