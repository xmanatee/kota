import { normalizeGeneratedWorkProposalKey, stageGeneratedWorkProposal } from "#modules/autonomy/generated-work-proposal.js";
import { findGeneratedWorkTask } from "#modules/autonomy/generated-work-task.js";
import { renderRepoTaskIntent } from "#modules/repo-tasks/repo-task-intent.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import type { GardenerDecision } from "./decision.js";
import { computeFingerprint } from "./fingerprint.js";

export type GardenerTaskSettlement = {
  taskId: string | null;
  proposalKey: string | null;
  touchedTaskQueue: boolean;
  disposition: "applied" | "unchanged" | "covered" | "no-action" | "deferred";
  reason: string;
  sourceTaskFingerprint: string | null;
  appliedTaskFingerprint: string | null;
};

export function gardenerTaskFingerprint(workspaceRoot: string, taskId: string | null): string {
  const task = listFullRepoTasks(workspaceRoot).find((task) => task.id === taskId);
  return computeFingerprint(task ? { id: task.id, state: task.state, priority: task.priority, body: task.body, dependsOn: task.dependsOn } : null);
}

export function stageGardenerTask(args: {
  topicKey?: string;
  workspaceRoot: string;
  runId: string;
  decision: GardenerDecision;
}): GardenerTaskSettlement {
  const { decision } = args;
  if (decision.action === "covered") {
    if (!listFullRepoTasks(args.workspaceRoot).some((t) => t.id === decision.existingTaskId)) {
      throw new Error(`Gardener cited a missing task: ${decision.existingTaskId}`);
    }
    const fingerprint = gardenerTaskFingerprint(args.workspaceRoot, decision.existingTaskId);
    return { taskId: decision.existingTaskId, proposalKey: null, touchedTaskQueue: false,
      disposition: "covered", reason: decision.rationale, sourceTaskFingerprint: fingerprint, appliedTaskFingerprint: fingerprint };
  }
  const proposal = decision.proposal;
  if (!proposal) return { taskId: null, proposalKey: null, touchedTaskQueue: false,
    disposition: "no-action", reason: decision.rationale, sourceTaskFingerprint: null, appliedTaskFingerprint: null };
  const proposalKey = args.topicKey
    ? normalizeGeneratedWorkProposalKey(args.topicKey)
    : `architecture-gardener:${proposal.mechanismKey}`;
  const existing = findGeneratedWorkTask(args.workspaceRoot, proposalKey);
  const sourceTaskFingerprint = gardenerTaskFingerprint(args.workspaceRoot, existing?.task.id ?? null);
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
  if (existing?.task.state === "open" || existing?.task.state === "blocked") {
    // Active intent includes blocked and retained builders. Follow terminal
    // evidence before reconsidering this proposal; never rewrite their contract.
    const unchanged = existing.task.state === "open" && existing.task.priority === proposal.priority &&
      existing.task.body.trim() === `# ${proposal.title}\n\n${body.trim()}`;
    return { taskId: existing.task.id, proposalKey, touchedTaskQueue: false,
      disposition: unchanged ? "unchanged" : "deferred", sourceTaskFingerprint, appliedTaskFingerprint: sourceTaskFingerprint,
      reason: unchanged ? "The task already contains this proposal." : "Publication deferred until the active task settles; review its outcome before applying the retained proposal." };
  }
  const staged = stageGeneratedWorkProposal({
    workspaceRoot: args.workspaceRoot,
    proposal: {
      kind: "task", proposalKey, title: proposal.title, priority: proposal.priority, body,
      provenance: { source: "architecture-gardener", runId: args.runId, evidenceRefs: decision.evidenceRefs },
    },
  });
  return { taskId: staged.taskId, proposalKey, touchedTaskQueue: staged.touchedTaskQueue,
    disposition: staged.touchedTaskQueue ? "applied" : "unchanged", sourceTaskFingerprint,
    appliedTaskFingerprint: gardenerTaskFingerprint(args.workspaceRoot, staged.taskId),
    reason: staged.actions.some((action) => action.kind === "reopened-task")
      ? "Reopened the same terminal task for the investigator's new evidence and explicit priority."
      : staged.touchedTaskQueue ? "Applied the proposal to the task queue." : "The task already contains this proposal." };
}
