import {
	continueClaimIfUnchanged,
	inspectTaskClaimWithOwnerRun,
	readActiveTaskClaim,
	taskClaimPath,
} from "./task-claim-files.js";
import type {
	ClaimTaskAttempt,
	ContinueTaskClaimInput,
	TaskClaim,
	TaskClaimInspection,
	TaskClaimRecoveryPath,
} from "./task-claim-types.js";

function skippedContinuation(
	taskId: string,
	claim: TaskClaim | null,
	inspection: TaskClaimInspection | null,
	recoveryPath: TaskClaimRecoveryPath,
	reason: string,
): ClaimTaskAttempt {
	return {
		claimed: false,
		taskId,
		claim,
		recoveryStatus: inspection?.recoveryStatus ?? null,
		safeToRetry: inspection?.safeToRetry ?? false,
		recoveryPath,
		reason,
	};
}

export function continueTaskClaim(input: ContinueTaskClaimInput): ClaimTaskAttempt {
	const path = taskClaimPath(input.projectDir, input.taskId);
	const current = readActiveTaskClaim(input.projectDir, input.taskId);
	if (!current) {
		return skippedContinuation(
			input.taskId,
			null,
			null,
			"write-conflict",
			"preserved task claim no longer exists",
		);
	}
	const inspection = inspectTaskClaimWithOwnerRun(
		input.projectDir,
		current,
		path,
		input.now,
	);
	if (
		current.runId !== input.sourceRunId ||
		current.workflowId !== input.workflowId
	) {
		return skippedContinuation(
			input.taskId,
			current,
			inspection,
			"write-conflict",
			`claim belongs to ${current.workflowId}/${current.runId}`,
		);
	}
	if (
		inspection.recoveryStatus !== "stale" &&
		inspection.recoveryStatus !== "pending-merge"
	) {
		return skippedContinuation(
			input.taskId,
			current,
			inspection,
			"skipped-active-claim",
			`claim is ${inspection.recoveryStatus}, not preserved recovery work`,
		);
	}

	const continued = continueClaimIfUnchanged(input.projectDir, current, input);
	if (!continued) {
		return skippedContinuation(
			input.taskId,
			readActiveTaskClaim(input.projectDir, input.taskId),
			null,
			"write-conflict",
			"claim changed during recovery continuation",
		);
	}
	return {
		claimed: true,
		taskId: input.taskId,
		claim: continued,
		recoveryStatus: "agent-running",
		safeToRetry: false,
		recoveryPath: "continued-preserved-claim",
		reason: null,
	};
}
