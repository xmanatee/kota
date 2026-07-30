import type { ServerResponse } from "node:http";
import type {
	ApprovalExecutionApproveAllResult,
	ApprovalExecutionSnapshot,
	ApprovalQueue,
	PendingApproval,
} from "#core/daemon/approval-queue.js";
import { jsonResponse } from "#core/server/session-pool.js";
import type { ToolRunnerContext } from "#core/tools/index.js";
import {
	ApprovalExecutionDescriptorMismatchError,
	type ApprovalExecutionLease,
	approveAllResponse,
	approvedApprovalResponse,
	prepareApprovalExecutionBatch,
	withApprovalExecutionLeases,
} from "./approval-execution.js";
import type { ApprovalReviewReceipt } from "./client.js";
import {
	writeApprovalInputUnavailable,
	writeApprovalScopeMismatch,
} from "./route-helpers.js";

function writeApprovalExecutionDescriptorMismatch(
	res: ServerResponse,
	queue: ApprovalQueue,
	approvals: PendingApproval[],
): void {
	jsonResponse(res, 409, {
		error: "Approval changed after execution preflight",
		reason: "approval_execution_descriptor_mismatch",
		approvals: approvals.map((item) => queue.projectForClient(item)),
	});
}

function writeApprovalReviewMismatch(
	res: ServerResponse,
	queue: ApprovalQueue,
	approvals: PendingApproval[],
): void {
	jsonResponse(res, 409, {
		error: "Approval changed since it was reviewed",
		reason: "approval_review_digest_mismatch",
		approvals: approvals.map((item) => queue.projectForClient(item)),
	});
}

type ApprovalMutationOutcome =
	| {
			kind: "success";
			body:
				| Awaited<ReturnType<typeof approvedApprovalResponse>>
				| Awaited<ReturnType<typeof approveAllResponse>>;
	  }
	| {
			kind: "scope_mismatch" | "descriptor_mismatch" | "input_unavailable";
			approvals: PendingApproval[];
	  };

function writeApprovalMutationOutcome(
	res: ServerResponse,
	queue: ApprovalQueue,
	selectedScopeId: string,
	outcome: ApprovalMutationOutcome,
): void {
	if (outcome.kind === "success") {
		jsonResponse(res, 200, outcome.body);
		return;
	}
	if (outcome.kind === "scope_mismatch") {
		writeApprovalScopeMismatch(res, selectedScopeId, outcome.approvals);
		return;
	}
	if (outcome.kind === "descriptor_mismatch") {
		writeApprovalExecutionDescriptorMismatch(res, queue, outcome.approvals);
		return;
	}
	writeApprovalInputUnavailable(res, outcome.approvals);
}

export async function writeApproveApprovalMutation(
	res: ServerResponse,
	queue: ApprovalQueue,
	id: string,
	expectedReviewDigest: string,
	note: string | undefined,
	executionContext: ToolRunnerContext | undefined,
): Promise<void> {
	const selectedScopeId = executionContext?.scopeId ?? queue.getScopeId();
	if (queue.getScopeId() !== selectedScopeId) {
		writeApprovalScopeMismatch(res, selectedScopeId, []);
		return;
	}
	const selection = queue.getExecutionSnapshot(id);
	if (!selection.ok && selection.reason === "not_found") {
		jsonResponse(res, 404, { error: "Approval not found or not pending" });
		return;
	}
	if (!selection.ok && selection.reason === "scope_mismatch") {
		writeApprovalScopeMismatch(
			res,
			selectedScopeId,
			selection.approval ? [selection.approval] : [],
		);
		return;
	}
	if (!selection.ok) {
		writeApprovalInputUnavailable(res, selection.approval ? [selection.approval] : []);
		return;
	}
	if (selection.snapshot.descriptor.reviewDigest !== expectedReviewDigest) {
		writeApprovalReviewMismatch(res, queue, [selection.snapshot.approval]);
		return;
	}
	const preflight = await prepareApprovalExecutionBatch([selection.snapshot], executionContext);
	if (!preflight.ok) {
		jsonResponse(res, preflight.status, preflight.body);
		return;
	}
	const outcome = await withApprovalExecutionLeases(
		preflight.leases.values(),
		async (): Promise<ApprovalMutationOutcome> => {
			const lease = preflight.leases.get(id);
			if (lease === undefined) {
				return {
					kind: "descriptor_mismatch",
					approvals: [selection.snapshot.approval],
				};
			}
			const result = queue.approveForExecution(lease, note);
			if (!result.ok && result.reason === "scope_mismatch") {
				return {
					kind: "scope_mismatch",
					approvals: result.approval ? [result.approval] : [],
				};
			}
			if (!result.ok && result.reason === "descriptor_mismatch") {
				return {
					kind: "descriptor_mismatch",
					approvals: result.approval
						? [result.approval]
						: [selection.snapshot.approval],
				};
			}
			if (!result.ok && result.reason === "input_unavailable") {
				return {
					kind: "input_unavailable",
					approvals: result.approval ? [result.approval] : [],
				};
			}
			if (!result.ok) {
				return {
					kind: "descriptor_mismatch",
					approvals: [selection.snapshot.approval],
				};
			}
			try {
				return {
					kind: "success",
					body: await approvedApprovalResponse(
						result.approval,
						executionContext,
						lease,
					),
				};
			} catch (error) {
				if (!(error instanceof ApprovalExecutionDescriptorMismatchError)) throw error;
				return { kind: "descriptor_mismatch", approvals: [error.approval] };
			}
		},
	);
	writeApprovalMutationOutcome(res, queue, selectedScopeId, outcome);
}

export async function writeApproveAllApprovalsMutation(
	res: ServerResponse,
	queue: ApprovalQueue,
	reviewReceipts: readonly ApprovalReviewReceipt[],
	note: string | undefined,
	executionContext: ToolRunnerContext | undefined,
): Promise<void> {
	const pendingApprovals = queue.list("pending");
	const selectedScopeId = executionContext?.scopeId ?? queue.getScopeId();
	const mismatched = pendingApprovals.filter(
		(item) => item.scopeId !== selectedScopeId,
	);
	if (queue.getScopeId() !== selectedScopeId || mismatched.length > 0) {
		writeApprovalScopeMismatch(res, selectedScopeId, mismatched);
		return;
	}
	const snapshots: ApprovalExecutionSnapshot[] = [];
	for (const item of pendingApprovals) {
		const selection = queue.getExecutionSnapshot(item.id);
		if (!selection.ok && selection.reason === "scope_mismatch") {
			writeApprovalScopeMismatch(
				res,
				selectedScopeId,
				selection.approval ? [selection.approval] : [],
			);
			return;
		}
		if (!selection.ok && selection.reason === "input_unavailable") {
			writeApprovalInputUnavailable(res, selection.approval ? [selection.approval] : []);
			return;
		}
		if (!selection.ok) {
			writeApprovalExecutionDescriptorMismatch(res, queue, [item]);
			return;
		}
		snapshots.push(selection.snapshot);
	}
	const receiptDigests = new Map(reviewReceipts.map((receipt) => [receipt.id, receipt.digest]));
	if (
		receiptDigests.size !== reviewReceipts.length
		|| snapshots.length !== reviewReceipts.length
		|| snapshots.some((snapshot) =>
			receiptDigests.get(snapshot.approval.id) !== snapshot.descriptor.reviewDigest
		)
	) {
		writeApprovalReviewMismatch(res, queue, pendingApprovals);
		return;
	}
	const preflight = await prepareApprovalExecutionBatch(snapshots, executionContext);
	if (!preflight.ok) {
		jsonResponse(res, preflight.status, preflight.body);
		return;
	}
	const outcome = await withApprovalExecutionLeases(
		preflight.leases.values(),
		async (): Promise<ApprovalMutationOutcome> => {
			const result = approveAllApprovalsLocal(
				queue,
				[...preflight.leases.values()],
				note,
			);
			if (!result.ok) {
				return { kind: result.reason, approvals: result.approvals };
			}
			try {
				return {
					kind: "success",
					body: await approveAllResponse(
						result.approvals,
						executionContext,
						preflight.leases,
					),
				};
			} catch (error) {
				if (!(error instanceof ApprovalExecutionDescriptorMismatchError)) throw error;
				return { kind: "descriptor_mismatch", approvals: [error.approval] };
			}
		},
	);
	writeApprovalMutationOutcome(res, queue, selectedScopeId, outcome);
}

function approveAllApprovalsLocal(
	queue: ApprovalQueue,
	leases: readonly ApprovalExecutionLease[],
	note?: string,
): ApprovalExecutionApproveAllResult {
	return queue.approvePendingForExecution(leases, note);
}
