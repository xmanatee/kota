import {
	blockReconciliation,
	branchBehind,
	type CheckpointAndReconcileAutomationWorktreeInput,
	canonicalDestructivePaths,
	changedPaths,
	reconciliationTimestamp,
	updateReconciliationRecord,
} from "./worktree-canonical-reconciliation-support.js";
import { inspectAutomationWorktree } from "./worktree-lifecycle.js";
import { readDirtyState } from "./worktree-lifecycle-support.js";
import type {
	AutomationWorktreeCanonicalReconciliation,
	AutomationWorktreeSelector,
} from "./worktree-lifecycle-types.js";
import { currentHead, runGit } from "./worktree-merge-gate-support.js";

export function checkpointPreservedAutomationWorktree(
	input: CheckpointAndReconcileAutomationWorktreeInput,
) {
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
		return {
			ready: false as const,
			record: blockReconciliation(input, record, "preserved worktree path is missing"),
		};
	}
	const existingMergeHeadResult = inspection.dirty.conflicted
		? runGit(workspaceDir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])
		: null;
	if (
		inspection.dirty.conflicted &&
		(inspection.metadata.state !== "pending-merge" || !existingMergeHeadResult?.ok)
	) {
		return {
			ready: false as const,
			record: blockReconciliation(
				input,
				record,
				"preserved conflict is not a runtime-owned pending merge",
			),
		};
	}
	if (!inspection.dirty.dirty) {
		return {
			ready: false as const,
			record: blockReconciliation(
				input,
				record,
				"preserved worktree has no changes to checkpoint",
			),
		};
	}

	let checkpointCommit = currentHead(workspaceDir);
	if (existingMergeHeadResult === null) {
		const staged = runGit(workspaceDir, ["add", "-A", "--", "."]);
		if (!staged.ok) {
			return {
				ready: false as const,
				record: blockReconciliation(
					input,
					record,
					staged.stderr || staged.stdout || "failed to stage preserved work checkpoint",
				),
			};
		}
		const checkpoint = runGit(workspaceDir, [
			"commit",
			"--quiet",
			"-m",
			`Checkpoint preserved builder work for ${input.recoveryRunId}`,
		]);
		if (!checkpoint.ok) {
			return {
				ready: false as const,
				record: blockReconciliation(
					input,
					record,
					checkpoint.stderr || checkpoint.stdout || "failed to commit preserved work checkpoint",
				),
			};
		}
		checkpointCommit = currentHead(workspaceDir);
		if (readDirtyState(workspaceDir).dirty) {
			return {
				ready: false as const,
				record: blockReconciliation(
					input,
					record,
					"preserved worktree remained dirty after checkpoint commit",
				),
			};
		}
	}

	try {
		const preservedPaths = changedPaths(
			workspaceDir,
			inspection.metadata.baseCommit,
			checkpointCommit,
		);
		const canonicalHeadCommit = currentHead(input.projectDir);
		const canonicalPaths = changedPaths(
			workspaceDir,
			inspection.metadata.baseCommit,
			canonicalHeadCommit,
		);
		const canonicalPathSet = new Set(canonicalPaths);
		record = updateReconciliationRecord(input, record, {
			phase: "reconciling-canonical",
			checkpointCommit,
			canonicalHeadCommit,
			branchBehindAtStart: branchBehind(
				workspaceDir,
				checkpointCommit,
				canonicalHeadCommit,
			),
			overlappingPaths: preservedPaths.filter((path) => canonicalPathSet.has(path)),
			canonicalDestructivePaths: canonicalDestructivePaths(
				workspaceDir,
				inspection.metadata.baseCommit,
				canonicalHeadCommit,
			),
		});
		return {
			ready: true as const,
			inspection,
			workspaceDir,
			record,
			checkpointCommit,
			preservedPaths,
			existingMergeHead: existingMergeHeadResult?.stdout ?? null,
		};
	} catch (error) {
		return {
			ready: false as const,
			record: blockReconciliation(
				input,
				{ ...record, checkpointCommit },
				error instanceof Error ? error.message : String(error),
			),
		};
	}
}
