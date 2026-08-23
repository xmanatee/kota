import { checkpointPreservedAutomationWorktree } from "./worktree-canonical-reconciliation-checkpoint.js";
import {
	blockReconciliation,
	boundedActualConflicts,
	branchBehind,
	type CheckpointAndReconcileAutomationWorktreeInput,
	canonicalDestructivePaths,
	changedPaths,
	resolveReconciliationConflicts,
	resurrectedDestructivePaths,
	runReconciliationValidations,
	updateReconciliationRecord,
} from "./worktree-canonical-reconciliation-support.js";
import { readDirtyState } from "./worktree-lifecycle-support.js";
import type { AutomationWorktreeCanonicalReconciliation } from "./worktree-lifecycle-types.js";
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
	const prepared = checkpointPreservedAutomationWorktree(input);
	if (!prepared.ready) return prepared.record;
	const {
		inspection,
		workspaceDir,
		checkpointCommit,
		preservedPaths,
		existingMergeHead,
	} = prepared;
	let record = prepared.record;

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
		let validatedCurrentTree = false;
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
		if (existingMergeHead !== null) {
			const pendingCanonicalHead = existingMergeHead;
			if (!isAncestor(workspaceDir, pendingCanonicalHead, canonicalHeadCommit)) {
				return blockReconciliation(
					input,
					record,
					"pending merge head is not an ancestor of the current canonical head",
				);
			}
			const conflicts = boundedActualConflicts(
				classifyConflicts(workspaceDir),
				new Set(destructivePaths),
			);
			if (conflicts.length === 0) {
				return blockReconciliation(
					input,
					record,
					"pending merge has no classified conflict paths",
				);
			}
			if (conflicts.some((conflict) => conflict.kind !== "text")) {
				return blockReconciliation(
					input,
					record,
					"pending canonical merge contains binary, generated, deletion, rename, or high-risk conflicts",
					conflicts,
				);
			}
			const resolution = await resolveReconciliationConflicts(
				input,
				record,
				workspaceDir,
				inspection.branch,
				pendingCanonicalHead,
				conflicts,
			);
			if (!resolution.ready) return resolution.record;
			record = resolution.record;
			validatedCurrentTree = true;
		}

		if (!isAncestor(workspaceDir, canonicalHeadCommit, currentHead(workspaceDir))) {
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
					canonicalHeadCommit,
					conflicts,
				);
				if (!resolution.ready) return resolution.record;
				record = resolution.record;
				validatedCurrentTree = true;
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
				const validations = runReconciliationValidations(
					workspaceDir,
					input.validationCommands,
				);
				const failedValidation = validations.find((validation) => !validation.passed);
				if (failedValidation) {
					const exitCode = failedValidation.exitCode === null
						? "unknown exit"
						: `exit ${failedValidation.exitCode}`;
					return blockReconciliation(
						input,
						{ ...record, validations },
						`canonical reconciliation validation failed: ${failedValidation.command.join(" ")} (${exitCode})`,
						[],
					);
				}
				const committed = commitResolvedMerge(workspaceDir, inspection.branch);
				if (!committed.ok) return blockReconciliation(input, record, committed.reason);
				record = { ...record, validations };
				validatedCurrentTree = true;
			}
		}

		const validations = validatedCurrentTree
			? record.validations
			: runReconciliationValidations(workspaceDir, input.validationCommands);
		const failedValidation = validations.find((validation) => !validation.passed);
		if (failedValidation) {
			const exitCode = failedValidation.exitCode === null
				? "unknown exit"
				: `exit ${failedValidation.exitCode}`;
			return blockReconciliation(
				input,
				{ ...record, validations },
				`canonical reconciliation validation failed: ${failedValidation.command.join(" ")} (${exitCode})`,
				[],
			);
		}
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
