import { lstatSync } from "node:fs";
import { join } from "node:path";
import type {
	AutomationWorktreeCanonicalConflict,
	AutomationWorktreeCanonicalReconciliation,
	AutomationWorktreeCanonicalValidation,
	AutomationWorktreeSelector,
} from "./worktree-lifecycle-types.js";
import {
	boundedSemanticReviewRetry,
	captureMergeIndexSnapshot,
	commitResolvedMerge,
	stageConflictPaths,
	validateResolvedMergeBoundary,
} from "./worktree-merge-gate-finalize.js";
import {
	canonicalConflictDiff,
	classifyConflicts,
	conflictMarkerConflicts,
	currentHead,
	runGit,
	runValidation,
} from "./worktree-merge-gate-support.js";
import type {
	MergeGateResolutionReview,
	MergeGateResolver,
} from "./worktree-merge-gate-types.js";

export type CheckpointAndReconcileAutomationWorktreeInput =
	AutomationWorktreeSelector & {
		recoveryRunId: string;
		artifactPath: string;
		validationCommands: readonly (readonly string[])[];
		resolver?: MergeGateResolver;
		maxResolutionAttempts?: number;
		lockTimeoutMs?: number;
		onProgress: (record: AutomationWorktreeCanonicalReconciliation) => void;
	};

const DEFAULT_RESOLUTION_ATTEMPTS = 2;

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

export async function resolveReconciliationConflicts(
	input: CheckpointAndReconcileAutomationWorktreeInput,
	record: AutomationWorktreeCanonicalReconciliation,
	workspaceDir: string,
	branch: string,
	canonicalHeadCommit: string,
	initialConflicts: AutomationWorktreeCanonicalConflict[],
): Promise<
	| { ready: true; record: AutomationWorktreeCanonicalReconciliation }
	| { ready: false; record: AutomationWorktreeCanonicalReconciliation }
> {
	const maxAttempts = input.maxResolutionAttempts ?? DEFAULT_RESOLUTION_ATTEMPTS;
	if (!input.resolver || maxAttempts <= 0) {
		return {
			ready: false,
			record: blockReconciliation(
				input,
				record,
				"text conflicts require the configured bounded merge resolver",
				initialConflicts,
			),
		};
	}
	let conflicts = initialConflicts;
	let validations: AutomationWorktreeCanonicalValidation[] = [];
	let previousValidation: AutomationWorktreeCanonicalValidation | null = null;
	let previousReview: MergeGateResolutionReview | undefined;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const beforeResolver = captureMergeIndexSnapshot(workspaceDir);
		const resolution = await input.resolver({
			taskId: input.taskId,
			workspaceDir,
			branch,
			baseCommit: record.originalBaseCommit,
			canonicalHeadCommit,
			headCommit: currentHead(workspaceDir),
			canonicalDiff: canonicalConflictDiff(
				workspaceDir,
				record.originalBaseCommit,
				canonicalHeadCommit,
				conflicts,
			),
			attempt,
			conflicts,
			previousValidation,
			...(previousReview !== undefined ? { previousReview } : {}),
		});
		if (!resolution.resolved) {
			const reviewRetry = boundedSemanticReviewRetry({
				workspaceDir,
				beforeResolver,
				allowedConflictPaths: conflicts.map((conflict) => conflict.path),
				resolution,
				attempt,
				maxAttempts,
			});
			if (reviewRetry.kind === "blocked") {
				return {
					ready: false,
					record: blockReconciliation(
						input,
						record,
						reviewRetry.violation.reason,
						reviewRetry.violation.conflicts,
					),
				};
			}
			if (reviewRetry.kind === "retry") {
				previousReview = reviewRetry.review;
				continue;
			}
			return {
				ready: false,
				record: blockReconciliation(
					input,
					{ ...record, validations },
					resolution.summary || "merge resolver did not resolve conflicts",
					conflicts,
				),
			};
		}
		const unresolvedMarkers = conflictMarkerConflicts(workspaceDir, conflicts);
		if (unresolvedMarkers.length > 0) {
			conflicts = unresolvedMarkers;
			continue;
		}
		const boundaryViolation = validateResolvedMergeBoundary(workspaceDir, {
			beforeResolver,
			allowedConflictPaths: conflicts.map((conflict) => conflict.path),
		});
		if (boundaryViolation) {
			return {
				ready: false,
				record: blockReconciliation(
					input,
					record,
					boundaryViolation.reason,
					boundaryViolation.conflicts,
				),
			};
		}
		const resurrected = resurrectedDestructivePaths(
			workspaceDir,
			record.canonicalDestructivePaths,
		);
		if (resurrected.length > 0) {
			return {
				ready: false,
				record: blockReconciliation(
					input,
					record,
					"resolved merge would resurrect paths deleted or renamed on canonical",
					resurrected.map((path) => ({
						path,
						kind: "blocked-path",
						reason: "canonical deletion or rename must remain authoritative",
					})),
				),
			};
		}
		validations = runReconciliationValidations(workspaceDir, input.validationCommands);
		const failedValidation = validations.find((validation) => !validation.passed);
		if (failedValidation) {
			previousValidation = failedValidation;
			if (attempt < maxAttempts) continue;
			const exitCode = failedValidation.exitCode === null
				? "unknown exit"
				: `exit ${failedValidation.exitCode}`;
			return {
				ready: false,
				record: blockReconciliation(
					input,
					{ ...record, validations },
					`canonical reconciliation validation failed: ${failedValidation.command.join(" ")} (${exitCode})`,
					[],
				),
			};
		}
		stageConflictPaths(workspaceDir, conflicts);
		const remaining = classifyConflicts(workspaceDir);
		if (remaining.length > 0) {
			conflicts = remaining;
			continue;
		}
		const committed = commitResolvedMerge(workspaceDir, branch);
		if (!committed.ok) {
			return {
				ready: false,
				record: blockReconciliation(input, record, committed.reason, []),
			};
		}
		return { ready: true, record: { ...record, validations } };
	}
	return {
		ready: false,
		record: blockReconciliation(
			input,
			record,
			"merge resolver exhausted bounded attempts",
			conflicts,
		),
	};
}
