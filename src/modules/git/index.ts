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
import { localWriteEffect } from "#core/tools/effect.js";
import { gitTool, runGit } from "./git.js";

export type {
	AutomationWorktreeCleanupStatus,
	AutomationWorktreeDirtySummary,
	AutomationWorktreeInspection,
	AutomationWorktreeMetadata,
	AutomationWorktreeOperatorState,
	AutomationWorktreeOperatorStatus,
	AutomationWorktreeRuntimeResources,
	AutomationWorktreeRunState,
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
	unlockAutomationWorktree,
	updateAutomationWorktreeRuntimeResources,
	updateAutomationWorktreeState,
} from "./worktree-lifecycle.js";
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
    effect: localWriteEffect(),
  },
];

const gitModule: KotaModule = {
  name: "git",
  version: "1.0.0",
  description: "Git version control tool with safety guardrails",
  tools,
};

export default gitModule;
