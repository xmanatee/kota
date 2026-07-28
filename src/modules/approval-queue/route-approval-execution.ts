import type { ServerResponse } from "node:http";
import {
	type ApprovalExecutionApproveAllResult,
	type ApprovalExecutionSnapshot,
	type ApprovalQueue,
	type PendingApproval,
	projectApprovalForClient,
} from "#core/daemon/approval-queue.js";
import { jsonResponse } from "#core/server/session-pool.js";
import type { ToolRunnerContext } from "#core/tools/index.js";
import {
	ApprovalExecutionDescriptorMismatchError,
	type ApprovalExecutionLease,
	approveAllResponse,
	approvedApprovalResponse,
	closeApprovalExecutionLeases,
	prepareApprovalExecutionBatch,
} from "./approval-execution.js";
import {
	writeApprovalInputUnavailable,
	writeApprovalScopeMismatch,
} from "./route-helpers.js";

function writeApprovalExecutionDescriptorMismatch(
	res: ServerResponse,
	approvals: PendingApproval[],
): void {
	jsonResponse(res, 409, {
		error: "Approval changed after execution preflight",
		reason: "approval_execution_descriptor_mismatch",
		approvals: approvals.map((item) => projectApprovalForClient(item)),
	});
}

export async function writeApproveApprovalMutation(
	res: ServerResponse,
	queue: ApprovalQueue,
	id: string,
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
	const preflight = await prepareApprovalExecutionBatch([selection.snapshot], executionContext);
	if (!preflight.ok) {
		jsonResponse(res, preflight.status, preflight.body);
		return;
	}
	const lease = preflight.leases.get(id);
	if (lease === undefined) {
		await closeApprovalExecutionLeases(preflight.leases.values());
		writeApprovalExecutionDescriptorMismatch(res, [selection.snapshot.approval]);
		return;
	}
	const result = queue.approveForExecution(lease, note);
	if (!result.ok && result.reason === "not_found") {
		await closeApprovalExecutionLeases(preflight.leases.values());
		writeApprovalExecutionDescriptorMismatch(res, [selection.snapshot.approval]);
		return;
	}
	if (!result.ok && result.reason === "scope_mismatch") {
		await closeApprovalExecutionLeases(preflight.leases.values());
		writeApprovalScopeMismatch(
			res,
			selectedScopeId,
			result.approval ? [result.approval] : [],
		);
		return;
	}
	if (!result.ok && result.reason === "descriptor_mismatch") {
		await closeApprovalExecutionLeases(preflight.leases.values());
		writeApprovalExecutionDescriptorMismatch(
			res,
			result.approval ? [result.approval] : [selection.snapshot.approval],
		);
		return;
	}
	if (!result.ok) {
		await closeApprovalExecutionLeases(preflight.leases.values());
		writeApprovalInputUnavailable(res, result.approval ? [result.approval] : []);
		return;
	}
	try {
		jsonResponse(res, 200, await approvedApprovalResponse(
			result.approval,
			executionContext,
			lease,
		));
	} catch (error) {
		if (!(error instanceof ApprovalExecutionDescriptorMismatchError)) throw error;
		writeApprovalExecutionDescriptorMismatch(res, [error.approval]);
	} finally {
		await closeApprovalExecutionLeases(preflight.leases.values());
	}
}

export async function writeApproveAllApprovalsMutation(
	res: ServerResponse,
	queue: ApprovalQueue,
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
			writeApprovalExecutionDescriptorMismatch(res, [item]);
			return;
		}
		snapshots.push(selection.snapshot);
	}
	const preflight = await prepareApprovalExecutionBatch(snapshots, executionContext);
	if (!preflight.ok) {
		jsonResponse(res, preflight.status, preflight.body);
		return;
	}
	const result = approveAllApprovalsLocal(
		queue,
		[...preflight.leases.values()],
		note,
	);
	if (!result.ok) {
		await closeApprovalExecutionLeases(preflight.leases.values());
		if (result.reason === "scope_mismatch") {
			writeApprovalScopeMismatch(res, selectedScopeId, result.approvals);
			return;
		}
		if (result.reason === "descriptor_mismatch") {
			writeApprovalExecutionDescriptorMismatch(res, result.approvals);
			return;
		}
		writeApprovalInputUnavailable(res, result.approvals);
		return;
	}
	try {
		jsonResponse(res, 200, await approveAllResponse(
			result.approvals,
			executionContext,
			preflight.leases,
		));
	} catch (error) {
		if (!(error instanceof ApprovalExecutionDescriptorMismatchError)) throw error;
		writeApprovalExecutionDescriptorMismatch(res, [error.approval]);
	} finally {
		await closeApprovalExecutionLeases(preflight.leases.values());
	}
}

function approveAllApprovalsLocal(
	queue: ApprovalQueue,
	leases: readonly ApprovalExecutionLease[],
	note?: string,
): ApprovalExecutionApproveAllResult {
	return queue.approvePendingForExecution(leases, note);
}
