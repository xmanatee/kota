import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
	assertCanonicalCheckoutReady,
	comparablePath,
	DEFAULT_WORKTREE_ROOT,
	emptyDirtyState,
	emptyPushState,
	git,
	metadataPath,
	parseWorktreeList,
	prepareAutomationWorktree,
	readDirtyState,
	readMetadata,
	readPushState,
	uniqueBranch,
	uniqueWorkspaceDir,
	writeMetadata,
} from "./worktree-lifecycle-support.js";

export { prepareAutomationWorktree } from "./worktree-lifecycle-support.js";
export type {
	AutomationWorktreeInspection,
	AutomationWorktreeMetadata,
	AutomationWorktreeSelector,
	AutomationWorktreeState,
	CleanupEligibility,
	CreateAutomationWorktreeInput,
	WorktreeDirtyState,
	WorktreeLockState,
	WorktreePushState,
} from "./worktree-lifecycle-types.js";

import type {
	AutomationWorktreeInspection,
	AutomationWorktreeMetadata,
	AutomationWorktreeSelector,
	AutomationWorktreeState,
	CleanupEligibility,
	CreateAutomationWorktreeInput,
	WorktreeDirtyState,
	WorktreeLockState,
	WorktreePushState,
} from "./worktree-lifecycle-types.js";

export function createAutomationWorktree(input: CreateAutomationWorktreeInput): AutomationWorktreeInspection {
	assertCanonicalCheckoutReady(input.projectDir);
	const baseRef = input.baseRef ?? "HEAD";
	const baseCommit = git(input.projectDir, ["rev-parse", baseRef]);
	const workspaceDir = uniqueWorkspaceDir(
		input.projectDir,
		input.worktreeRoot ?? DEFAULT_WORKTREE_ROOT,
		input.taskId,
		input.runId,
	);
	const branch = uniqueBranch(input.projectDir, input.taskId, input.runId);
	mkdirSync(dirname(workspaceDir), { recursive: true });
	git(input.projectDir, ["worktree", "add", "--quiet", "-b", branch, workspaceDir, baseCommit]);
	const copiedSetupFiles = prepareAutomationWorktree(input.projectDir, workspaceDir, input.includeFile);
	const now = new Date().toISOString();
	writeMetadata(input.projectDir, {
		schemaVersion: 1,
		taskId: input.taskId,
		runId: input.runId,
		workflowId: input.workflowId,
		owner: input.owner,
		workspaceDir,
		branch,
		baseCommit,
		createdAt: now,
		updatedAt: now,
		state: "active",
		copiedSetupFiles,
	});
	return inspectAutomationWorktree({ projectDir: input.projectDir, taskId: input.taskId, runId: input.runId });
}

export function lockAutomationWorktree(selector: AutomationWorktreeSelector, reason: string): AutomationWorktreeInspection {
	const metadata = readMetadata(selector);
	git(selector.projectDir, ["worktree", "lock", "--reason", reason, metadata.workspaceDir]);
	return inspectAutomationWorktree(selector);
}

export function unlockAutomationWorktree(selector: AutomationWorktreeSelector): AutomationWorktreeInspection {
	const metadata = readMetadata(selector);
	git(selector.projectDir, ["worktree", "unlock", metadata.workspaceDir]);
	return inspectAutomationWorktree(selector);
}

export function updateAutomationWorktreeState(
	selector: AutomationWorktreeSelector,
	state: Exclude<AutomationWorktreeState, "removed">,
	reason?: string,
): AutomationWorktreeInspection {
	const metadata = { ...readMetadata(selector), state, updatedAt: new Date().toISOString() };
	if (reason) metadata.stateReason = reason;
	writeMetadata(selector.projectDir, metadata);
	return inspectAutomationWorktree(selector);
}

export function inspectAutomationWorktree(selector: AutomationWorktreeSelector): AutomationWorktreeInspection {
	const metadata = readMetadata(selector);
	const metadataWorkspace = comparablePath(metadata.workspaceDir);
	const entry = parseWorktreeList(selector.projectDir).find((item) => comparablePath(item.path) === metadataWorkspace);
	const exists = entry !== undefined && existsSync(metadata.workspaceDir);
	const dirty = exists ? readDirtyState(metadata.workspaceDir) : emptyDirtyState();
	const headCommit = exists ? git(metadata.workspaceDir, ["rev-parse", "HEAD"]) : "";
	const push = exists ? readPushState(metadata.workspaceDir, metadata.baseCommit, headCommit) : emptyPushState();
	const branch = entry?.branch ?? metadata.branch;
	const lock = entry?.lock ?? { locked: false, reason: null };
	const cleanup = cleanupEligibility(metadata, exists, dirty, lock, headCommit, push);
	return {
		metadata,
		metadataPath: metadataPath(selector.projectDir, metadata.taskId, metadata.runId),
		exists,
		branch,
		baseCommit: metadata.baseCommit,
		headCommit,
		dirty,
		lock,
		push,
		cleanup,
	};
}

export function cleanupAutomationWorktree(selector: AutomationWorktreeSelector): {
	removed: boolean;
	inspection: AutomationWorktreeInspection;
} {
	const before = inspectAutomationWorktree(selector);
	if (!before.cleanup.eligible) {
		writeMetadata(selector.projectDir, {
			...before.metadata,
			updatedAt: new Date().toISOString(),
			lastCleanupBlockers: before.cleanup.blockers,
		});
		return { removed: false, inspection: inspectAutomationWorktree(selector) };
	}
	git(selector.projectDir, ["worktree", "remove", before.metadata.workspaceDir]);
	writeMetadata(selector.projectDir, {
		...before.metadata,
		state: "removed",
		removedAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		lastCleanupBlockers: [],
	});
	return { removed: true, inspection: inspectAutomationWorktree(selector) };
}

function cleanupEligibility(
	metadata: AutomationWorktreeMetadata,
	exists: boolean,
	dirty: WorktreeDirtyState,
	lock: WorktreeLockState,
	headCommit: string,
	push: WorktreePushState,
): CleanupEligibility {
	const blockers: string[] = [];
	if (!exists && metadata.state !== "removed") blockers.push("worktree path is missing");
	if (lock.locked) blockers.push(lock.reason ? `worktree is locked: ${lock.reason}` : "worktree is locked");
	if (dirty.conflicted) blockers.push("worktree has conflicted paths");
	if (dirty.trackedDirty) blockers.push("worktree has uncommitted tracked changes");
	if (dirty.untracked) blockers.push("worktree has untracked files");
	if (metadata.state === "pending-merge") blockers.push("worktree is pending merge");
	if (metadata.state !== "merged" && headCommit && headCommit !== metadata.baseCommit) {
		blockers.push("branch has commits that are not marked merged");
	}
	if (push.unpushed) {
		blockers.push("branch has unpushed commits");
	}
	return { eligible: blockers.length === 0 && exists, blockers };
}
