import {
	assertCanonicalCheckoutReady,
	comparablePath,
	git,
	parseWorktreeList,
	readMetadata,
} from "./worktree-lifecycle-support.js";
import type { AutomationWorktreeSelector } from "./worktree-lifecycle-types.js";
import {
	conflictMarkerConflicts,
	currentHead,
	merged,
	pending,
	runGit,
	runValidation,
} from "./worktree-merge-gate-support.js";
import type { MergeGateConflict, MergeGateResult } from "./worktree-merge-gate-types.js";

export type MergeIndexSnapshot = {
	entriesByPath: ReadonlyMap<string, readonly string[]>;
	stagedPaths: readonly string[];
};

export type MergeResolutionBoundaryViolation = {
	reason: string;
	conflicts: MergeGateConflict[];
};

export type CommitResolvedMergeResult =
	| {
			ok: true;
	  }
	| {
			ok: false;
			reason: string;
	  };

function lines(output: string): string[] {
	return output ? output.split(/\r?\n/).filter(Boolean).sort() : [];
}

function indexEntriesByPath(workspaceDir: string): Map<string, string[]> {
	const output = git(workspaceDir, ["ls-files", "--stage"]);
	const entries = new Map<string, string[]>();
	for (const line of lines(output)) {
		const separator = line.indexOf("\t");
		if (separator < 0) continue;
		const path = line.slice(separator + 1);
		const entry = line.slice(0, separator);
		const pathEntries = entries.get(path) ?? [];
		pathEntries.push(entry);
		entries.set(path, pathEntries);
	}
	return entries;
}

function stagedPaths(workspaceDir: string): string[] {
	return lines(git(workspaceDir, ["diff", "--cached", "--name-only"]));
}

function unstagedPaths(workspaceDir: string): string[] {
	return lines(git(workspaceDir, ["diff", "--name-only"]));
}

function untrackedPaths(workspaceDir: string): string[] {
	return lines(git(workspaceDir, ["ls-files", "--others", "--exclude-standard"]));
}

function conflictFor(path: string, reason: string): MergeGateConflict {
	return {
		path,
		kind: "blocked-path",
		reason,
	};
}

function sameEntries(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
	if (!left || !right || left.length !== right.length) return false;
	return left.every((entry, index) => entry === right[index]);
}

function unlockForMergedCleanup(selector: AutomationWorktreeSelector, workspaceDir: string): string | null {
	const workspacePath = comparablePath(workspaceDir);
	const entry = parseWorktreeList(selector.projectDir).find((item) => comparablePath(item.path) === workspacePath);
	if (entry?.lock.locked !== true) return null;
	const unlocked = runGit(selector.projectDir, ["worktree", "unlock", workspaceDir]);
	if (unlocked.ok) return null;
	return unlocked.stderr || unlocked.stdout || "worktree unlock failed before merged cleanup";
}

export function validateAndFastForwardCanonical(
	selector: AutomationWorktreeSelector,
	input: {
		branch: string;
		baseCommit: string;
		canonicalHeadCommit: string;
		validationCommand: readonly string[] | undefined;
		validation?: MergeGateResult["validation"];
		resolutionAttempts: number;
	},
): MergeGateResult {
	const workspaceDir = readMetadata(selector).workspaceDir;
	const validation = input.validation === undefined
		? runValidation(workspaceDir, input.validationCommand)
		: input.validation;
	const headCommit = currentHead(workspaceDir);
	if (validation && !validation.passed) {
		return pending(selector, {
			branch: input.branch,
			baseCommit: input.baseCommit,
			canonicalHeadCommit: input.canonicalHeadCommit,
			headCommit,
			reason: "validation failed after merge gate integration",
			conflicts: [],
			resolutionAttempts: input.resolutionAttempts,
			validation,
			status: "blocked",
		});
	}
	assertCanonicalCheckoutReady(selector.projectDir);
	const latestCanonicalHead = currentHead(selector.projectDir);
	if (latestCanonicalHead !== input.canonicalHeadCommit) {
		return pending(selector, {
			branch: input.branch,
			baseCommit: input.baseCommit,
			canonicalHeadCommit: input.canonicalHeadCommit,
			headCommit,
			reason: "canonical checkout advanced during merge gate",
			conflicts: [],
			resolutionAttempts: input.resolutionAttempts,
			validation,
			status: "blocked",
		});
	}
	const unlockFailure = unlockForMergedCleanup(selector, workspaceDir);
	if (unlockFailure) {
		return pending(selector, {
			branch: input.branch,
			baseCommit: input.baseCommit,
			canonicalHeadCommit: input.canonicalHeadCommit,
			headCommit,
			reason: unlockFailure,
			conflicts: [],
			resolutionAttempts: input.resolutionAttempts,
			validation,
			status: "blocked",
		});
	}
	const fastForward = runGit(selector.projectDir, ["merge", "--ff-only", headCommit]);
	if (!fastForward.ok) {
		return pending(selector, {
			branch: input.branch,
			baseCommit: input.baseCommit,
			canonicalHeadCommit: input.canonicalHeadCommit,
			headCommit,
			reason: fastForward.stderr || fastForward.stdout || "canonical fast-forward failed",
			conflicts: [],
			resolutionAttempts: input.resolutionAttempts,
			validation,
			status: "blocked",
		});
	}
	return merged(selector, {
		branch: input.branch,
		baseCommit: input.baseCommit,
		canonicalHeadCommit: input.canonicalHeadCommit,
		headCommit,
		mergeCommit: currentHead(selector.projectDir),
		resolutionAttempts: input.resolutionAttempts,
		validation,
	});
}

export function commitResolvedMerge(workspaceDir: string, branch: string): CommitResolvedMergeResult {
	if (!runGit(workspaceDir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).ok) {
		return { ok: false, reason: "resolved merge is no longer in progress before commit" };
	}
	const commit = runGit(workspaceDir, ["commit", "--quiet", "-m", `Merge canonical branch into ${branch}`]);
	if (!commit.ok) {
		return {
			ok: false,
			reason: commit.stderr || commit.stdout || "resolved merge commit failed",
		};
	}
	return { ok: true };
}

export function captureMergeIndexSnapshot(workspaceDir: string): MergeIndexSnapshot {
	return {
		entriesByPath: indexEntriesByPath(workspaceDir),
		stagedPaths: stagedPaths(workspaceDir),
	};
}

export function validateResolvedMergeBoundary(
	workspaceDir: string,
	input: {
		beforeResolver: MergeIndexSnapshot;
		allowedConflictPaths: readonly string[];
	},
): MergeResolutionBoundaryViolation | null {
	const allowedStagedPaths = new Set([...input.beforeResolver.stagedPaths, ...input.allowedConflictPaths]);
	const unexpectedStaged = stagedPaths(workspaceDir).filter((path) => !allowedStagedPaths.has(path));
	if (unexpectedStaged.length > 0) {
		return {
			reason: "merge resolver staged paths outside allowed textual conflicts",
			conflicts: unexpectedStaged.map((path) =>
				conflictFor(path, "resolver staged path outside allowed textual conflicts"),
			),
		};
	}

	const allowedConflictPaths = new Set(input.allowedConflictPaths);
	const currentEntries = indexEntriesByPath(workspaceDir);
	const changedProtectedPaths = [...input.beforeResolver.entriesByPath.entries()]
		.filter(([path, entries]) => !allowedConflictPaths.has(path) && !sameEntries(entries, currentEntries.get(path)))
		.map(([path]) => path)
		.sort();
	if (changedProtectedPaths.length > 0) {
		return {
			reason: "merge resolver changed index entries outside allowed textual conflicts",
			conflicts: changedProtectedPaths.map((path) =>
				conflictFor(path, "resolver changed index entry outside allowed textual conflicts"),
			),
		};
	}

	const unexpectedUnstaged = unstagedPaths(workspaceDir).filter((path) => !allowedConflictPaths.has(path));
	if (unexpectedUnstaged.length > 0) {
		return {
			reason: "merge resolver left unstaged paths outside allowed textual conflicts",
			conflicts: unexpectedUnstaged.map((path) =>
				conflictFor(path, "resolver left unstaged path outside allowed textual conflicts"),
			),
		};
	}

	const unexpectedUntracked = untrackedPaths(workspaceDir).filter((path) => !allowedConflictPaths.has(path));
	if (unexpectedUntracked.length > 0) {
		return {
			reason: "merge resolver left untracked paths outside allowed textual conflicts",
			conflicts: unexpectedUntracked.map((path) =>
				conflictFor(path, "resolver left untracked path outside allowed textual conflicts"),
			),
		};
	}

	return null;
}

export function stageConflictPaths(workspaceDir: string, conflicts: MergeGateConflict[]): MergeGateConflict[] {
	const unresolvedMarkers = conflictMarkerConflicts(workspaceDir, conflicts);
	if (unresolvedMarkers.length > 0) return unresolvedMarkers;
	if (conflicts.length > 0) git(workspaceDir, ["add", "--", ...conflicts.map((conflict) => conflict.path)]);
	return [];
}
