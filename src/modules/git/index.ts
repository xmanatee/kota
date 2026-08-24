/**
 * Git module — version control operations with safety guardrails.
 *
 * Tools:
 *   git — status, diff, log, show, add, commit, branch, push
 *
 * Force-push to main/master is blocked. Large diffs are auto-truncated.
 * Deletion of protected branches (main, master) is blocked.
 */


import type { KotaModule, ToolDef } from "#core/modules/module-types.js";
import { networkWriteEffect } from "#core/tools/effect.js";
import { gitTool, runGit } from "./git.js";
import { resolveGitToolEffect } from "./push-safety.js";

export type { CheckpointAndReconcileAutomationWorktreeInput } from "./worktree-canonical-reconciliation.js";
export { checkpointAndReconcileAutomationWorktree } from "./worktree-canonical-reconciliation.js";
export { updateAutomationWorktreeCanonicalReconciliation } from "./worktree-canonical-reconciliation-metadata.js";
export type {
	AutomationWorktreeCleanupStatus,
	AutomationWorktreeDirtySummary,
	AutomationWorktreeInspection,
	AutomationWorktreeMetadata,
	AutomationWorktreeOperatorState,
	AutomationWorktreeOperatorStatus,
	AutomationWorktreeReconcileAction,
	AutomationWorktreeReconcileItem,
	AutomationWorktreeReconcileResult,
	AutomationWorktreeRunState,
	AutomationWorktreeRuntimeResources,
	AutomationWorktreeSelector,
	AutomationWorktreeState,
	CleanupEligibility,
	CreateAutomationWorktreeInput,
	WorktreeDirtyState,
	WorktreeLockState,
	WorktreePushState,
} from "./worktree-lifecycle.js";
export {
	cleanupAutomationWorktree,
	createAutomationWorktree,
	inspectAutomationWorktree,
	listAutomationWorktreeStatuses,
	lockAutomationWorktree,
	prepareAutomationWorktree,
	reconcileAutomationWorktrees,
	unlockAutomationWorktree,
	updateAutomationWorktreeRuntimeResources,
	updateAutomationWorktreeState,
} from "./worktree-lifecycle.js";
export type {
	AutomationWorktreeCanonicalConflict,
	AutomationWorktreeCanonicalReconciliation,
	AutomationWorktreeCanonicalReconciliationDisposition,
	AutomationWorktreeCanonicalReconciliationPhase,
	AutomationWorktreeCanonicalValidation,
} from "./worktree-lifecycle-types.js";
export type {
	MergeAutomationWorktreeInput,
	MergeConflictKind,
	MergeGateConflict,
	MergeGateResolver,
	MergeGateResolverRequest,
	MergeGateResolverResult,
	MergeGateResult,
	MergeGateStatus,
	MergeGateValidation,
} from "./worktree-merge-gate.js";
export { mergeAutomationWorktree } from "./worktree-merge-gate.js";

const tools: ToolDef[] = [
  {
    tool: gitTool,
    runner: runGit,
    effect: networkWriteEffect(),
    resolveEffect: resolveGitToolEffect,
  },
];

const gitModule: KotaModule = {
  name: "git",
  version: "1.0.0",
  description: "Git version control tool with safety guardrails",
  dependencies: ["execution"],
  manifest: {
    schemaVersion: 1,
    capabilities: [
      {
        id: "git.repository",
        description:
          "Inspect and mutate local Git state and push operator-authorized updates to configured remotes.",
        scope: "external",
        scopePolicyHooks: ["external-effects", "owner-confirmation", "writes"],
      },
    ],
    dataClasses: [
      {
        id: "git.repository-state",
        description:
          "Local repository metadata, diffs, commit history, branches, and remote update results.",
        sensitivity: "internal",
        retention: "project-durable",
        redaction: "metadata-only",
      },
    ],
    simulation: {
      support: "external-effects-blocked",
      blockedReasons: [
        "Git pushes mutate configured remotes and are blocked in workflow trial mode.",
      ],
    },
  },
  tools,
};

export default gitModule;
