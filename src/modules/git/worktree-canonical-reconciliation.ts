import {
	blockReconciliation,
	boundedActualConflicts,
	branchBehind,
	type CheckpointAndReconcileAutomationWorktreeInput,
	canonicalDestructivePaths,
	changedPaths,
	reconciliationTimestamp,
	resolveReconciliationConflicts,
	resurrectedDestructivePaths,
	runReconciliationValidations,
	updateReconciliationRecord,
} from "./worktree-canonical-reconciliation-support.js";
import { inspectAutomationWorktree } from "./worktree-lifecycle.js";
import { readDirtyState } from "./worktree-lifecycle-support.js";
import type {
	AutomationWorktreeCanonicalReconciliation,
	AutomationWorktreeSelector,
} from "./worktree-lifecycle-types.js";
import { commitResolvedMerge } from "./worktree-merge-gate-finalize.js";
import {
	acquireMergeGateLock,
	releaseMergeGateLock,
} from "./worktree-merge-gate-lock.js";
import {
	classifyConflicts,
	currentHead,
	isAncestor,
	runGit,
} from "./worktree-merge-gate-support.js";

export type { CheckpointAndReconcileAutomationWorktreeInput } from "./worktree-canonical-reconciliation-support.js";

export async function checkpointAndReconcileAutomationWorktree(
	input: CheckpointAndReconcileAutomationWorktreeInput,
): Promise<AutomationWorktreeCanonicalReconciliation> {
	const selector: AutomationWorktreeSelector = {
		projectDir: input.projectDir,
		taskId: input.taskId,
		runId: input.runId,
	};
	const inspection = inspectAutomationWorktree(selector);
	const workspaceDir = inspection.metadata.workspaceDir;
	let record: AutomationWorktreeCanonicalReconciliation = {
		phase: "checkpointing",
		disposition: "pending",
		originalBaseCommit: inspection.metadata.baseCommit,
		checkpointCommit: null,
		canonicalHeadCommit: currentHead(input.projectDir),
		integratedCanonicalHeadCommit: null,
		branchBehindAtStart: null,
		branchBehindAtResume: null,
		overlappingPaths: [],
		canonicalDestructivePaths: [],
		conflicts: [],
		validations: [],
		reason: null,
		artifactPath: input.artifactPath,
		updatedAt: reconciliationTimestamp(),
	};
	input.onProgress(record);

	if (!inspection.exists) {
		return blockReconciliation(input, record, "preserved worktree path is missing");
	}
	if (inspection.dirty.conflicted) {
		return blockReconciliation(
			input,
			record,
			"preserved worktree was already conflicted before checkpointing",
		);
	}
	if (!inspection.dirty.dirty) {
		return blockReconciliation(input, record, "preserved worktree has no changes to checkpoint");
	}

	const staged = runGit(workspaceDir, ["add", "-A", "--", "."]);
	if (!staged.ok) {
		return blockReconciliation(
			input,
			record,
			staged.stderr || staged.stdout || "failed to stage preserved work checkpoint",
		);
	}
	const checkpoint = runGit(workspaceDir, [
		"commit",
		"--quiet",
		"-m",
		`Checkpoint preserved builder work for ${input.recoveryRunId}`,
	]);
	if (!checkpoint.ok) {
		return blockReconciliation(
			input,
			record,
			checkpoint.stderr || checkpoint.stdout || "failed to commit preserved work checkpoint",
		);
	}
	const checkpointCommit = currentHead(workspaceDir);
	if (readDirtyState(workspaceDir).dirty) {
		return blockReconciliation(input, record, "preserved worktree remained dirty after checkpoint commit");
	}
	let preservedPaths: string[];
	try {
		preservedPaths = changedPaths(
			workspaceDir,
			inspection.metadata.baseCommit,
			checkpointCommit,
		);
		const checkpointCanonicalHead = currentHead(input.projectDir);
		const checkpointCanonicalPaths = changedPaths(
			workspaceDir,
			inspection.metadata.baseCommit,
			checkpointCanonicalHead,
		);
		const checkpointCanonicalPathSet = new Set(checkpointCanonicalPaths);
		record = updateReconciliationRecord(input, record, {
			phase: "reconciling-canonical",
			checkpointCommit,
			canonicalHeadCommit: checkpointCanonicalHead,
			branchBehindAtStart: branchBehind(
				workspaceDir,
				checkpointCommit,
				checkpointCanonicalHead,
			),
			overlappingPaths: preservedPaths.filter((path) =>
				checkpointCanonicalPathSet.has(path),
			),
			canonicalDestructivePaths: canonicalDestructivePaths(
				workspaceDir,
				inspection.metadata.baseCommit,
				checkpointCanonicalHead,
			),
		});
	} catch (error) {
		return blockReconciliation(
			input,
			{ ...record, checkpointCommit },
			error instanceof Error ? error.message : String(error),
		);
	}

	const lock = await acquireMergeGateLock({
		projectDir: input.projectDir,
		taskId: input.taskId,
		runId: input.runId,
		timeoutMs: input.lockTimeoutMs,
	});
	if (!lock.acquired) {
		return blockReconciliation(input, record, lock.reason);
	}

	try {
		const canonicalHeadCommit = currentHead(input.projectDir);
		if (canonicalHeadCommit !== record.canonicalHeadCommit) {
			const canonicalPaths = changedPaths(
				workspaceDir,
				inspection.metadata.baseCommit,
				canonicalHeadCommit,
			);
			const canonicalPathSet = new Set(canonicalPaths);
			record = updateReconciliationRecord(input, record, {
				canonicalHeadCommit,
				branchBehindAtStart: branchBehind(
					workspaceDir,
					checkpointCommit,
					canonicalHeadCommit,
				),
				overlappingPaths: preservedPaths.filter((path) =>
					canonicalPathSet.has(path),
				),
				canonicalDestructivePaths: canonicalDestructivePaths(
					workspaceDir,
					inspection.metadata.baseCommit,
					canonicalHeadCommit,
				),
			});
		}
		const destructivePaths = record.canonicalDestructivePaths;

		const canonicalDirty = readDirtyState(input.projectDir);
		if (canonicalDirty.trackedDirty || canonicalDirty.untracked) {
			return blockReconciliation(
				input,
				record,
				`canonical checkout is dirty before recovery reconciliation: ${canonicalDirty.entries.join(", ")}`,
			);
		}

		if (!isAncestor(workspaceDir, canonicalHeadCommit, checkpointCommit)) {
			const merge = runGit(workspaceDir, [
				"merge",
				"--no-ff",
				"--no-commit",
				canonicalHeadCommit,
			]);
			if (!merge.ok) {
				const conflicts = boundedActualConflicts(
					classifyConflicts(workspaceDir),
					new Set(destructivePaths),
				);
				if (conflicts.length === 0) {
					return blockReconciliation(
						input,
						record,
						merge.stderr || merge.stdout || "canonical merge failed without classified conflicts",
					);
				}
				if (conflicts.some((conflict) => conflict.kind !== "text")) {
					return blockReconciliation(
						input,
						record,
						"canonical merge contains binary, generated, deletion, rename, or high-risk conflicts",
						conflicts,
					);
				}
				const resolution = await resolveReconciliationConflicts(
					input,
					record,
					workspaceDir,
					inspection.branch,
					conflicts,
				);
				if (!resolution.ready) return resolution.record;
				record = resolution.record;
			} else {
				const resurrected = resurrectedDestructivePaths(workspaceDir, destructivePaths);
				if (resurrected.length > 0) {
					return blockReconciliation(
						input,
						record,
						"clean canonical merge would resurrect deleted or renamed paths",
						resurrected.map((path) => ({
							path,
							kind: "blocked-path",
							reason: "canonical deletion or rename must remain authoritative",
						})),
					);
				}
				const committed = commitResolvedMerge(workspaceDir, inspection.branch);
				if (!committed.ok) return blockReconciliation(input, record, committed.reason);
			}
		}

		const validations = runReconciliationValidations(workspaceDir, input.validationCommands);
		const latestCanonicalHead = currentHead(input.projectDir);
		if (latestCanonicalHead !== canonicalHeadCommit) {
			return blockReconciliation(
				input,
				{ ...record, validations },
				"canonical checkout advanced during preserved recovery reconciliation",
			);
		}
		const headCommit = currentHead(workspaceDir);
		const behindAtResume = branchBehind(
			workspaceDir,
			headCommit,
			canonicalHeadCommit,
		);
		if (behindAtResume !== 0) {
			return blockReconciliation(
				input,
				{ ...record, validations },
				"reconciled worktree still trails the captured canonical head",
			);
		}
		const failedValidation = validations.find((validation) => !validation.passed);
		if (failedValidation) {
			const exitCode = failedValidation.exitCode === null
				? "unknown exit"
				: `exit ${failedValidation.exitCode}`;
			return blockReconciliation(
				input,
				{
					...record,
					integratedCanonicalHeadCommit: canonicalHeadCommit,
					validations,
				},
				`canonical reconciliation validation failed: ${failedValidation.command.join(" ")} (${exitCode})`,
			);
		}
		return updateReconciliationRecord(input, record, {
			phase: "ready-to-resume",
			disposition: "ready-to-resume",
			integratedCanonicalHeadCommit: canonicalHeadCommit,
			branchBehindAtResume: behindAtResume,
			conflicts: [],
			validations,
			reason: null,
		});
	} catch (error) {
		return blockReconciliation(
			input,
			record,
			error instanceof Error ? error.message : String(error),
		);
	} finally {
		releaseMergeGateLock(input.projectDir);
	}
}
