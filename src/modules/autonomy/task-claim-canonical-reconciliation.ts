import {
	inspectTaskClaim,
	readActiveTaskClaim,
	taskClaimPath,
	writeClaim,
} from "./task-claim-files.js";
import type {
	TaskClaimCanonicalReconciliationInput,
	TaskClaimTerminalResult,
} from "./task-claim-types.js";

export function updateTaskClaimCanonicalReconciliation(
	input: TaskClaimCanonicalReconciliationInput,
): TaskClaimTerminalResult {
	const now = input.now ?? new Date();
	const path = taskClaimPath(input.projectDir, input.taskId);
	const claim = readActiveTaskClaim(input.projectDir, input.taskId);
	if (claim === null) {
		return {
			taskId: input.taskId,
			changed: false,
			claim: null,
			recoveryStatus: "released",
			safeToRetry: true,
			reason: "no active claim",
		};
	}
	if (
		claim.taskId !== input.taskId ||
		claim.runId !== input.runId ||
		claim.workflowId !== input.workflowId
	) {
		return {
			taskId: input.taskId,
			changed: false,
			claim,
			recoveryStatus: inspectTaskClaim(claim, path, now).recoveryStatus,
			safeToRetry: false,
			reason: `claim belongs to ${claim.workflowId}/${claim.runId}`,
		};
	}
	if (input.canonicalReconciliation.originalBaseCommit !== claim.baseCommit) {
		return {
			taskId: input.taskId,
			changed: false,
			claim,
			recoveryStatus: inspectTaskClaim(claim, path, now).recoveryStatus,
			safeToRetry: false,
			reason: "canonical reconciliation cannot rewrite the original claim base",
		};
	}
	const next = {
		...claim,
		canonicalReconciliation: input.canonicalReconciliation,
		updatedAt: now.toISOString(),
		evidence: input.evidence,
	};
	writeClaim(input.projectDir, next, "w");
	const inspection = inspectTaskClaim(next, path, now);
	return {
		taskId: input.taskId,
		changed: true,
		claim: next,
		recoveryStatus: inspection.recoveryStatus,
		safeToRetry: inspection.safeToRetry,
		reason: null,
	};
}
