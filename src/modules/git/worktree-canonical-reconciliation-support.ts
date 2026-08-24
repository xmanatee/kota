import { lstatSync } from "node:fs";
import { join } from "node:path";
import type {
	AutomationWorktreeCanonicalConflict,
	AutomationWorktreeCanonicalReconciliation,
	AutomationWorktreeCanonicalValidation,
	AutomationWorktreeSelector,
} from "./worktree-lifecycle-types.js";
import {
	runGit,
	runValidation,
} from "./worktree-merge-gate-support.js";
import type { MergeGateResolver } from "./worktree-merge-gate-types.js";

export type CheckpointAndReconcileAutomationWorktreeInput =
	AutomationWorktreeSelector & {
		recoveryRunId: string;
		artifactPath: string;
		validationCommands: readonly (readonly string[])[];
		resolver?: MergeGateResolver;
		maxResolutionAttempts?: number;
		signal?: AbortSignal;
		onProgress: (
			record: AutomationWorktreeCanonicalReconciliation,
		) => void | Promise<void>;
	};

function nulSeparated(output: string): string[] {
	return output.split("\0").filter(Boolean);
}

export function changedPaths(repoDir: string, from: string, to: string): string[] {
	const result = runGit(repoDir, ["diff", "--name-only", "-z", `${from}..${to}`]);
	if (!result.ok) {
		throw new Error(result.stderr || result.stdout || "could not compare changed paths");
	}
	return nulSeparated(result.stdout).sort();
}

export function canonicalDestructivePaths(
	repoDir: string,
	from: string,
	to: string,
): string[] {
	const result = runGit(repoDir, [
		"diff",
		"--name-status",
		"--find-renames",
		"--diff-filter=DR",
		"-z",
		`${from}..${to}`,
	]);
	if (!result.ok) {
		throw new Error(
			result.stderr || result.stdout || "could not compare canonical destructive paths",
		);
	}
	const tokens = nulSeparated(result.stdout);
	const paths = new Set<string>();
	for (let index = 0; index < tokens.length; ) {
		const status = tokens[index++] ?? "";
		if (status.startsWith("R")) {
			const source = tokens[index++];
			index += 1;
			if (source) paths.add(source);
			continue;
		}
		const path = tokens[index++];
		if (status === "D" && path) paths.add(path);
	}
	return [...paths].sort();
}

export function branchBehind(
	repoDir: string,
	branchHead: string,
	canonicalHead: string,
): number | null {
	const result = runGit(repoDir, [
		"rev-list",
		"--left-right",
		"--count",
		`${branchHead}...${canonicalHead}`,
	]);
	if (!result.ok) return null;
	const [, behindRaw] = result.stdout.trim().split(/\s+/);
	const behind = Number.parseInt(behindRaw ?? "", 10);
	return Number.isSafeInteger(behind) && behind >= 0 ? behind : null;
}

export function reconciliationTimestamp(): string {
	return new Date().toISOString();
}

export function updateReconciliationRecord(
	input: CheckpointAndReconcileAutomationWorktreeInput,
	record: AutomationWorktreeCanonicalReconciliation,
	updates: Partial<AutomationWorktreeCanonicalReconciliation>,
): AutomationWorktreeCanonicalReconciliation {
	const next = { ...record, ...updates, updatedAt: reconciliationTimestamp() };
	input.onProgress(next);
	return next;
}

export function blockReconciliation(
	input: CheckpointAndReconcileAutomationWorktreeInput,
	record: AutomationWorktreeCanonicalReconciliation,
	reason: string,
	conflicts: AutomationWorktreeCanonicalConflict[] = record.conflicts,
): AutomationWorktreeCanonicalReconciliation {
	return updateReconciliationRecord(input, record, {
		phase: "conflict-blocked",
		disposition: "needs-review",
		conflicts,
		reason,
	});
}

export function boundedActualConflicts(
	conflicts: AutomationWorktreeCanonicalConflict[],
	destructivePaths: ReadonlySet<string>,
): AutomationWorktreeCanonicalConflict[] {
	return conflicts.map((conflict) =>
		destructivePaths.has(conflict.path)
			? {
					path: conflict.path,
					kind: "blocked-path" as const,
					reason: "canonical deletion or rename requires preserved recovery review",
				}
			: conflict,
	);
}

export function hasUnresolvableBoundedConflict(
	conflicts: readonly AutomationWorktreeCanonicalConflict[],
	destructivePaths: ReadonlySet<string>,
): boolean {
	return conflicts.some(
		(conflict) =>
			conflict.kind === "binary" ||
			(conflict.kind === "blocked-path" && !destructivePaths.has(conflict.path)),
	);
}

export function resurrectedDestructivePaths(
	workspaceDir: string,
	destructivePaths: readonly string[],
): string[] {
	return destructivePaths.filter(
		(path) =>
			lstatSync(join(workspaceDir, path), { throwIfNoEntry: false }) !== undefined,
	);
}

export function runReconciliationValidations(
	workspaceDir: string,
	commands: readonly (readonly string[])[],
): AutomationWorktreeCanonicalValidation[] {
	return commands.flatMap((command) => {
		const validation = runValidation(workspaceDir, command);
		return validation === null ? [] : [validation];
	});
}
