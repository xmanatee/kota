import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	assertCanonicalCheckoutReady,
	comparablePath,
	DEFAULT_WORKTREE_ROOT,
	emptyDirtyState,
	emptyPushState,
	git,
	isGitJsonObject,
	localBranchExists,
	metadataDir,
	metadataPath,
	parseWorktreeList,
	prepareAutomationWorktree,
	readAutomationWorktreeMetadataPath,
	readDirtyState,
	readGitJsonFile,
	readMetadata,
	readPushState,
	uniqueBranch,
	uniqueWorkspaceDir,
	writeMetadata,
} from "./worktree-lifecycle-support.js";

export { prepareAutomationWorktree } from "./worktree-lifecycle-support.js";
export type {
	AutomationWorktreeCleanupStatus,
	AutomationWorktreeDirtySummary,
	AutomationWorktreeInspection,
	AutomationWorktreeMetadata,
	AutomationWorktreeOperatorState,
	AutomationWorktreeOperatorStatus,
	AutomationWorktreeRunState,
	AutomationWorktreeRuntimeResources,
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
	AutomationWorktreeOperatorStatus,
	AutomationWorktreeRunState,
	AutomationWorktreeRuntimeResources,
	AutomationWorktreeSelector,
	AutomationWorktreeState,
	CleanupEligibility,
	CreateAutomationWorktreeInput,
	WorktreeDirtyState,
	WorktreeLockState,
	WorktreePushState,
} from "./worktree-lifecycle-types.js";

const WORKFLOW_TERMINAL_STATUSES = new Set(["success", "failed", "interrupted", "completed-with-warnings"]);

export type DisposedAutomationWorktreeResult = {
	removed: boolean;
	inspection: AutomationWorktreeInspection;
	message: string;
	blockers: string[];
	uniqueCommits: string[];
};

export type AutomationWorktreeUniqueCommits = {
	commits: string[];
	branchAhead: number | null;
	branchBehind: number | null;
	error?: string;
};

export type AutomationWorktreeReconcileAction =
	| "active"
	| "removed"
	| "preserved"
	| "unlocked-preserved"
	| "unlocked-removed";

export type AutomationWorktreeReconcileItem = {
	taskId: string;
	runId: string;
	workflowId: string;
	action: AutomationWorktreeReconcileAction;
	runState: AutomationWorktreeRunState;
	metadataState: AutomationWorktreeState;
	dirtyState: AutomationWorktreeOperatorStatus["dirtyState"];
	lockedBefore: boolean;
	unlocked: boolean;
	removed: boolean;
	blockers: string[];
	message: string;
};

export type AutomationWorktreeReconcileResult = {
	inspected: number;
	active: number;
	unlocked: number;
	removed: number;
	preserved: number;
	preservedDirty: number;
	preservedBlocked: number;
	items: AutomationWorktreeReconcileItem[];
};

export type DisposeAutomationWorktreeInput = AutomationWorktreeSelector & {
	reason: string;
	disposition: "released" | "superseded";
	supersededByCommit?: string;
	discardWorktreeChanges?: boolean;
};

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
	state: Exclude<AutomationWorktreeState, "removed" | "merged">,
	reason?: string,
): AutomationWorktreeInspection {
	if ((state as string) === "merged") {
		throw new Error("Use markAutomationWorktreeMerged(selector, mergedCommit) for merged worktrees.");
	}
	const nextState: AutomationWorktreeState = state;
	const metadata = { ...readMetadata(selector), state: nextState, updatedAt: new Date().toISOString() };
	if (reason) metadata.stateReason = reason;
	writeMetadata(selector.projectDir, metadata);
	return inspectAutomationWorktree(selector);
}

export function markAutomationWorktreePendingMerge(
	selector: AutomationWorktreeSelector,
	reason: string,
): AutomationWorktreeInspection {
	const metadata = {
		...readMetadata(selector),
		state: "pending-merge" as const,
		stateReason: reason,
		updatedAt: new Date().toISOString(),
	};
	writeMetadata(selector.projectDir, metadata);
	return inspectAutomationWorktree(selector);
}

export function markAutomationWorktreeMerged(
	selector: AutomationWorktreeSelector,
	mergedCommit: string,
	reason = "merge gate accepted branch",
): AutomationWorktreeInspection {
	const now = new Date().toISOString();
	const metadata = {
		...readMetadata(selector),
		state: "merged" as const,
		stateReason: reason,
		mergedAt: now,
		mergedCommit,
		updatedAt: now,
		lastCleanupBlockers: [],
	};
	writeMetadata(selector.projectDir, metadata);
	return inspectAutomationWorktree(selector);
}

export function updateAutomationWorktreeRuntimeResources(
	selector: AutomationWorktreeSelector,
	runtimeResources: AutomationWorktreeRuntimeResources,
): AutomationWorktreeInspection {
	const metadata = { ...readMetadata(selector), runtimeResources, updatedAt: new Date().toISOString() };
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
	const runState = readAutomationWorktreeRunState(selector.projectDir, metadata.runId);
	const cleanup = cleanupEligibility(metadata, exists, dirty, lock, headCommit, push, runState);
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
		runState,
		cleanup,
	};
}

export function listAutomationWorktreeStatuses(projectDir: string): AutomationWorktreeOperatorStatus[] {
	return listAutomationWorktreeMetadata(projectDir)
		.map((metadata) =>
			operatorStatusForInspection(
				inspectAutomationWorktree({
					projectDir,
					taskId: metadata.taskId,
					runId: metadata.runId,
				}),
			),
		);
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
	deleteMergedLocalBranch(selector.projectDir, before.metadata.branch);
	writeMetadata(selector.projectDir, {
		...before.metadata,
		state: "removed",
		removedAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		lastCleanupBlockers: [],
	});
	return { removed: true, inspection: inspectAutomationWorktree(selector) };
}

export function reconcileAutomationWorktrees(projectDir: string): AutomationWorktreeReconcileResult {
	const items: AutomationWorktreeReconcileItem[] = [];
	for (const metadata of listAutomationWorktreeMetadata(projectDir)) {
		if (metadata.state === "removed") continue;
		const selector = { projectDir, taskId: metadata.taskId, runId: metadata.runId };
		const before = inspectAutomationWorktree(selector);
		const lockedBefore = before.lock.locked;
		if (before.runState === "active") {
			items.push(reconcileItem(before, {
				action: "active",
				lockedBefore,
				unlocked: false,
				removed: false,
				blockers: before.cleanup.blockers,
				message: "owning workflow run is active; worktree left untouched",
			}));
			continue;
		}

		let current = before;
		let unlocked = false;
		let unlockBlocker: string | null = null;
		if (shouldUnlockTerminalWorktreeLock(before)) {
			try {
				unlockAutomationWorktree(selector);
				unlocked = true;
				current = inspectAutomationWorktree(selector);
			} catch (error) {
				unlockBlocker = `failed to unlock terminal builder worktree: ${
					error instanceof Error ? error.message : String(error)
				}`;
				current = before;
			}
		}

		const cleanup = cleanupAutomationWorktree(selector);
		current = cleanup.inspection;
		const removed = cleanup.removed;
		const dirtyState = dirtySummaryFor(current.dirty);
		const blockers = [...(current.metadata.lastCleanupBlockers ?? current.cleanup.blockers)];
		if (unlockBlocker !== null) blockers.unshift(unlockBlocker);
		items.push(reconcileItem(current, {
			action: removed
				? unlocked ? "unlocked-removed" : "removed"
				: unlocked ? "unlocked-preserved" : "preserved",
			lockedBefore,
			unlocked,
			removed,
			blockers,
			message: removed
				? "stale cleanup-eligible worktree removed"
				: unlockBlocker !== null
					? "stale worktree preserved because unlock failed"
				: dirtyState === "dirty" || dirtyState === "conflicted"
					? "stale worktree preserved with workspace-change blockers"
					: "stale worktree preserved with cleanup blockers",
		}));
	}
	return summarizeReconcileItems(items);
}

function shouldUnlockTerminalWorktreeLock(inspection: AutomationWorktreeInspection): boolean {
	return (
		inspection.metadata.workflowId === "builder" &&
		inspection.runState === "finished" &&
		inspection.lock.locked
	);
}

function listAutomationWorktreeMetadata(projectDir: string): AutomationWorktreeMetadata[] {
	const dir = metadataDir(projectDir);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter(isAutomationWorktreeMetadataFileName)
		.map((name) => readMetadataFile(projectDir, name))
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function reconcileItem(
	inspection: AutomationWorktreeInspection,
	fields: Omit<
		AutomationWorktreeReconcileItem,
		"taskId" | "runId" | "workflowId" | "runState" | "metadataState" | "dirtyState"
	>,
): AutomationWorktreeReconcileItem {
	return {
		taskId: inspection.metadata.taskId,
		runId: inspection.metadata.runId,
		workflowId: inspection.metadata.workflowId,
		runState: inspection.runState,
		metadataState: inspection.metadata.state,
		dirtyState: dirtySummaryFor(inspection.dirty),
		...fields,
	};
}

function summarizeReconcileItems(
	items: AutomationWorktreeReconcileItem[],
): AutomationWorktreeReconcileResult {
	const preserved = items.filter((item) => !item.removed && item.action !== "active");
	return {
		inspected: items.length,
		active: items.filter((item) => item.action === "active").length,
		unlocked: items.filter((item) => item.unlocked).length,
		removed: items.filter((item) => item.removed).length,
		preserved: preserved.length,
		preservedDirty: preserved.filter((item) => item.dirtyState !== "clean").length,
		preservedBlocked: preserved.filter((item) => item.dirtyState === "clean").length,
		items,
	};
}

export function listAutomationWorktreeUniqueCommits(
	projectDir: string,
	branchOrCommit: string,
): AutomationWorktreeUniqueCommits {
	if (!branchOrCommit) return { commits: [], branchAhead: null, branchBehind: null };
	let commits: string[] = [];
	let error: string | undefined;
	try {
		const output = git(projectDir, ["log", "--format=%H %s", `HEAD..${branchOrCommit}`]);
		commits = output ? output.split("\n").filter(Boolean) : [];
	} catch (caught) {
		commits = [];
		error = `failed to inspect unique commits for ${branchOrCommit}: ${
			caught instanceof Error ? caught.message : String(caught)
		}`;
	}
	let branchAhead: number | null = null;
	let branchBehind: number | null = null;
	try {
		const output = git(projectDir, ["rev-list", "--left-right", "--count", `HEAD...${branchOrCommit}`]);
		const [left, right] = output.split(/\s+/).map((part) => Number.parseInt(part, 10));
		if (Number.isFinite(left)) branchBehind = left;
		if (Number.isFinite(right)) branchAhead = right;
	} catch (caught) {
		branchAhead = null;
		branchBehind = null;
		error ??= `failed to inspect branch relation for ${branchOrCommit}: ${
			caught instanceof Error ? caught.message : String(caught)
		}`;
	}
	return {
		commits,
		branchAhead,
		branchBehind,
		...(error !== undefined ? { error } : {}),
	};
}

export function disposeAutomationWorktree(
	input: DisposeAutomationWorktreeInput,
): DisposedAutomationWorktreeResult {
	const before = inspectAutomationWorktree(input);
	const unique = listAutomationWorktreeUniqueCommits(
		input.projectDir,
		before.branch || before.headCommit,
	);
	const blockers: string[] = [];
	if (!before.exists) blockers.push("worktree path is missing");
	if (before.runState === "active") blockers.push("worktree run is active");
	if (before.dirty.conflicted) blockers.push("worktree has conflicted paths");
	if (before.dirty.dirty && input.discardWorktreeChanges !== true) {
		blockers.push("worktree has local changes and discardWorktreeChanges was not accepted");
	}
	if (unique.error !== undefined) blockers.push(unique.error);
	if (unique.commits.length > 0 && !input.supersededByCommit) {
		blockers.push("branch has unique commits and no superseding commit was provided");
	}
	if (input.supersededByCommit !== undefined) {
		try {
			git(input.projectDir, ["cat-file", "-e", `${input.supersededByCommit}^{commit}`]);
		} catch (caught) {
			blockers.push(
				`superseding commit does not exist: ${input.supersededByCommit}: ${
					caught instanceof Error ? caught.message : String(caught)
				}`,
			);
		}
	}
	if (blockers.length > 0) {
		writeMetadata(input.projectDir, {
			...before.metadata,
			updatedAt: new Date().toISOString(),
			lastCleanupBlockers: blockers,
		});
		return {
			removed: false,
			inspection: inspectAutomationWorktree(input),
			message: `Refused to dispose automation worktree ${before.metadata.taskId}/${before.metadata.runId}`,
			blockers,
			uniqueCommits: unique.commits,
		};
	}

	if (before.lock.locked) {
		try {
			git(input.projectDir, ["worktree", "unlock", before.metadata.workspaceDir]);
		} catch (caught) {
			const message = `failed to unlock worktree before disposition: ${
				caught instanceof Error ? caught.message : String(caught)
			}`;
			writeMetadata(input.projectDir, {
				...before.metadata,
				updatedAt: new Date().toISOString(),
				lastCleanupBlockers: [message],
			});
			return {
				removed: false,
				inspection: inspectAutomationWorktree(input),
				message,
				blockers: [message],
				uniqueCommits: unique.commits,
			};
		}
	}

	const forceRemove =
		before.dirty.dirty ||
		before.metadata.state === "pending-merge" ||
		unique.commits.length > 0;
	git(input.projectDir, [
		"worktree",
		"remove",
		...(forceRemove ? ["--force"] : []),
		before.metadata.workspaceDir,
	]);
	deleteLocalBranch(input.projectDir, before.metadata.branch, unique.commits.length > 0);
	const now = new Date().toISOString();
	writeMetadata(input.projectDir, {
		...before.metadata,
		state: "removed",
		stateReason: [
			`disposed as ${input.disposition}: ${input.reason}`,
			...(input.supersededByCommit !== undefined
				? [`superseded by ${input.supersededByCommit}`]
				: []),
		].join("; "),
		removedAt: now,
		updatedAt: now,
		lastCleanupBlockers: [],
	});
	return {
		removed: true,
		inspection: inspectAutomationWorktree(input),
		message: `Disposed automation worktree ${before.metadata.taskId}/${before.metadata.runId}`,
		blockers: [],
		uniqueCommits: unique.commits,
	};
}

function deleteMergedLocalBranch(projectDir: string, branch: string): void {
	if (!localBranchExists(projectDir, branch)) return;
	git(projectDir, ["branch", "-d", branch]);
}

function deleteLocalBranch(projectDir: string, branch: string, force: boolean): void {
	if (!localBranchExists(projectDir, branch)) return;
	git(projectDir, ["branch", force ? "-D" : "-d", branch]);
}

function cleanupEligibility(
	metadata: AutomationWorktreeMetadata,
	exists: boolean,
	dirty: WorktreeDirtyState,
	lock: WorktreeLockState,
	headCommit: string,
	push: WorktreePushState,
	runState: AutomationWorktreeRunState,
): CleanupEligibility {
	const blockers: string[] = [];
	if (!exists && metadata.state !== "removed") blockers.push("worktree path is missing");
	if (metadata.state === "active" && runState === "active") blockers.push("worktree run is active");
	if (lock.locked) {
		const lockSubject = metadata.state === "active" && runState !== "active" ? "stale worktree" : "worktree";
		blockers.push(lock.reason ? `${lockSubject} is locked: ${lock.reason}` : `${lockSubject} is locked`);
	}
	if (dirty.conflicted) blockers.push("worktree has conflicted paths");
	if (dirty.trackedDirty) blockers.push("worktree has uncommitted tracked changes");
	if (dirty.untracked) blockers.push("worktree has untracked files");
	if (metadata.state === "pending-merge") blockers.push("worktree is pending merge");
	if (metadata.state !== "merged" && headCommit && headCommit !== metadata.baseCommit) {
		blockers.push("branch has commits that are not marked merged");
	}
	if (push.unpushed && metadata.mergedCommit !== headCommit) {
		blockers.push("branch has unpushed commits");
	}
	return { eligible: blockers.length === 0 && exists, blockers };
}

function isAutomationWorktreeMetadataFileName(fileName: string): boolean {
	return fileName.endsWith(".json") && !fileName.endsWith(".merge-gate.json");
}

function readMetadataFile(projectDir: string, fileName: string): AutomationWorktreeMetadata {
	return readAutomationWorktreeMetadataPath(join(metadataDir(projectDir), fileName));
}

function readAutomationWorktreeRunState(projectDir: string, runId: string): AutomationWorktreeRunState {
	const activeRunIds = readActiveWorkflowRunIds(projectDir);
	const isActive = activeRunIds.has(runId);
	const runMetadataPath = join(projectDir, ".kota", "runs", runId, "metadata.json");
	if (!existsSync(runMetadataPath)) {
		if (isActive) throw new Error(`Invalid workflow state: active run ${runId} has no metadata at ${runMetadataPath}`);
		return "missing";
	}
	const runMetadata = readGitJsonFile(runMetadataPath);
	if (!isGitJsonObject(runMetadata) || typeof runMetadata.status !== "string") {
		throw new Error(`Invalid workflow run metadata at ${runMetadataPath}: missing status`);
	}
	if (runMetadata.status === "running") return isActive ? "active" : "orphaned-running";
	if (WORKFLOW_TERMINAL_STATUSES.has(runMetadata.status)) return "finished";
	throw new Error(`Invalid workflow run metadata at ${runMetadataPath}: unsupported status ${runMetadata.status}`);
}

function readActiveWorkflowRunIds(projectDir: string): Set<string> {
	const statePath = join(projectDir, ".kota", "workflow-state.json");
	if (!existsSync(statePath)) return new Set();
	const state = readGitJsonFile(statePath);
	if (!isGitJsonObject(state)) throw new Error(`Invalid workflow state at ${statePath}: expected object`);
	const { activeRuns } = state;
	if (activeRuns === undefined) return new Set();
	if (!Array.isArray(activeRuns)) throw new Error(`Invalid workflow state at ${statePath}: activeRuns must be an array`);
	const runIds = new Set<string>();
	for (const [index, activeRun] of activeRuns.entries()) {
		if (!isGitJsonObject(activeRun) || typeof activeRun.runId !== "string") {
			throw new Error(`Invalid workflow state at ${statePath}: activeRuns[${index}].runId must be a string`);
		}
		runIds.add(activeRun.runId);
	}
	return runIds;
}

function operatorStatusForInspection(inspection: AutomationWorktreeInspection): AutomationWorktreeOperatorStatus {
	const { metadata } = inspection;
	const cleanupStatus = cleanupStatusFor(inspection);
	return {
		taskId: metadata.taskId,
		runId: metadata.runId,
		workflowId: metadata.workflowId,
		owner: metadata.owner,
		workspaceDir: metadata.workspaceDir,
		metadataPath: inspection.metadataPath,
		exists: inspection.exists,
		branch: inspection.branch,
		baseCommit: inspection.baseCommit,
		headCommit: inspection.headCommit,
		state: operatorStateFor(inspection, cleanupStatus),
		metadataState: metadata.state,
		runState: inspection.runState,
		dirtyState: dirtySummaryFor(inspection.dirty),
		dirtyEntries: inspection.dirty.entries,
		mergeStatus: mergeStatusFor(inspection),
		cleanupStatus,
		cleanupEligible: inspection.cleanup.eligible,
		cleanupBlockers: inspection.cleanup.blockers,
		...(inspection.runState === "active" && metadata.runtimeResources !== undefined
			? { runtimeResources: metadata.runtimeResources }
			: {}),
		nextAction: nextActionFor(inspection, cleanupStatus),
	};
}

function operatorStateFor(
	inspection: AutomationWorktreeInspection,
	cleanupStatus: AutomationWorktreeOperatorStatus["cleanupStatus"],
): AutomationWorktreeOperatorStatus["state"] {
	if (inspection.metadata.state === "removed" && !inspection.exists) return "removed";
	if (inspection.dirty.conflicted) return "conflicted";
	if (inspection.metadata.state === "removed" && cleanupStatus !== "removed") return "active";
	if (
		inspection.metadata.state === "active" &&
		(inspection.runState === "finished" || inspection.runState === "missing" || inspection.runState === "orphaned-running")
	) {
		return "stale";
	}
	return inspection.metadata.state;
}

function dirtySummaryFor(dirty: WorktreeDirtyState): AutomationWorktreeOperatorStatus["dirtyState"] {
	if (dirty.conflicted) return "conflicted";
	if (dirty.dirty) return "dirty";
	return "clean";
}

function cleanupStatusFor(inspection: AutomationWorktreeInspection): AutomationWorktreeOperatorStatus["cleanupStatus"] {
	if (inspection.metadata.state === "removed" && !inspection.exists) return "removed";
	return inspection.cleanup.eligible ? "eligible" : "blocked";
}

function mergeStatusFor(inspection: AutomationWorktreeInspection): string {
	const { metadata } = inspection;
	if (metadata.state === "pending-merge") {
		return metadata.stateReason ? `pending-merge: ${metadata.stateReason}` : "pending-merge";
	}
	if (inspection.dirty.conflicted) return "conflicted";
	if (metadata.state === "merged") {
		return metadata.mergedCommit ? `merged: ${metadata.mergedCommit}` : "merged";
	}
	if (metadata.state === "removed") return "removed";
	return "not merged";
}

function nextActionFor(
	inspection: AutomationWorktreeInspection,
	cleanupStatus: AutomationWorktreeOperatorStatus["cleanupStatus"],
): string {
	const { metadata } = inspection;
	const operatorState = operatorStateFor(inspection, cleanupStatus);
	if (cleanupStatus === "removed") return "none; git worktree list and KOTA metadata both show removed";
	if (inspection.dirty.conflicted) return "resolve merge conflicts before merge or cleanup";
	if (cleanupStatus === "eligible") return `cleanup eligible for ${metadata.taskId}/${metadata.runId}`;
	if (metadata.state === "pending-merge") {
		return metadata.stateReason ? `review pending merge: ${metadata.stateReason}` : "review pending merge";
	}
	if (operatorState === "stale") {
		if (inspection.lock.locked) {
			return inspection.lock.reason
				? `unlock stale worktree after verifying workspace changes: ${inspection.lock.reason}`
				: "unlock stale worktree after verifying workspace changes";
		}
		if (inspection.dirty.trackedDirty || inspection.dirty.untracked) {
			return "inspect stale workspace changes before cleanup";
		}
		if (inspection.push.unpushed) return "push or merge stale branch commits before cleanup";
		if (!inspection.exists) return "inspect missing stale worktree path before cleanup";
		return `cleanup stale worktree for ${metadata.taskId}/${metadata.runId}`;
	}
	if (inspection.lock.locked) {
		return inspection.lock.reason
			? `wait for lock owner or unlock after verifying: ${inspection.lock.reason}`
			: "wait for lock owner or unlock after verifying the run stopped";
	}
	if (inspection.dirty.trackedDirty || inspection.dirty.untracked) {
		return "inspect workspace changes before cleanup";
	}
	if (inspection.push.unpushed) return "push or merge branch commits before cleanup";
	if (!inspection.exists) return "inspect missing worktree path before cleanup";
	if (metadata.state === "active") return `wait for ${metadata.owner} to finish`;
	return "resolve cleanup blockers before removal";
}
