import {
	type ApprovalExecutionDescriptor,
	createApprovalExecutionDescriptor,
	pendingApprovalMatchesExecutionDescriptor,
} from "./approval-execution-descriptor.js";
import {
	type ApprovalExecutionSnapshot,
	isWorkflowGateApproval,
	type PendingApproval,
} from "./approval-queue-types.js";
import type { ApprovalRecordRepository } from "./approval-record-repository.js";
import type { ApprovalFileIdentity } from "./approval-record-storage.js";
import {
	type ApprovalResolutionAuthenticator,
	ApprovalResolutionIntegrityError,
} from "./approval-resolution-integrity.js";

export type SelectedApprovalExecution = ApprovalExecutionSnapshot & {
	reviewContext?: string;
	recordIdentity: ApprovalFileIdentity;
};

export type ApprovalExecutionSelectionResult =
	| { ok: true; selected: SelectedApprovalExecution }
	| {
			ok: false;
			reason:
				| "not_found"
				| "input_unavailable"
				| "scope_mismatch"
				| "descriptor_mismatch";
			approval?: PendingApproval;
	  };

export type ApprovalExecutionBulkSelectionResult =
	| { ok: true; selected: SelectedApprovalExecution[] }
	| {
			ok: false;
			reason: "input_unavailable" | "scope_mismatch" | "descriptor_mismatch";
			approvals: PendingApproval[];
	  };

export function selectApprovalForExecution(
	records: ApprovalRecordRepository,
	executionInputs: ReadonlyMap<string, PendingApproval["input"]>,
	reviewContexts: ReadonlyMap<string, string>,
	scopeId: string,
	id: string,
	authenticator: ApprovalResolutionAuthenticator,
): ApprovalExecutionSelectionResult {
	const stored = records.read(id);
	if (!stored || stored.item.status !== "pending") return { ok: false, reason: "not_found" };
	if (stored.item.scopeId !== scopeId) {
		return { ok: false, reason: "scope_mismatch", approval: stored.item };
	}
	let approval: PendingApproval;
	try {
		approval = authenticator.authenticatePending(stored.item);
	} catch (error) {
		if (!(error instanceof ApprovalResolutionIntegrityError)) throw error;
		return {
			ok: false,
			reason: error.reason === "pending_snapshot_mismatch"
				? "descriptor_mismatch"
				: "input_unavailable",
			approval: stored.item,
		};
	}
	const executionInput = executionInputs.get(id)
		?? (isWorkflowGateApproval(approval) ? approval.input : undefined);
	if (executionInput === undefined) {
		return { ok: false, reason: "input_unavailable", approval: stored.item };
	}
	const reviewContext = reviewContexts.get(id);
	if (approval.contextRedaction !== undefined && reviewContext === undefined) {
		return { ok: false, reason: "input_unavailable", approval: stored.item };
	}
	return {
		ok: true,
		selected: {
			approval,
			executionInput,
			...(reviewContext !== undefined ? { reviewContext } : {}),
			descriptor: createApprovalExecutionDescriptor(approval, executionInput, reviewContext),
			recordIdentity: stored.identity,
		},
	};
}

export function selectApprovalsForExecution(
	records: ApprovalRecordRepository,
	executionInputs: ReadonlyMap<string, PendingApproval["input"]>,
	reviewContexts: ReadonlyMap<string, string>,
	scopeId: string,
	descriptors: readonly ApprovalExecutionDescriptor[],
	authenticator: ApprovalResolutionAuthenticator,
): ApprovalExecutionBulkSelectionResult {
	const selected: SelectedApprovalExecution[] = [];
	for (const descriptor of descriptors) {
		const result = selectApprovalForExecution(
			records,
			executionInputs,
			reviewContexts,
			scopeId,
			descriptor.approvalId,
			authenticator,
		);
		if (!result.ok) {
			return {
				ok: false,
				reason: result.reason === "not_found" ? "descriptor_mismatch" : result.reason,
				approvals: result.approval ? [result.approval] : [],
			};
		}
		if (!pendingApprovalMatchesExecutionDescriptor(
			result.selected.approval,
			result.selected.executionInput,
			result.selected.reviewContext,
			descriptor,
		)) {
			return {
				ok: false,
				reason: "descriptor_mismatch",
				approvals: [result.selected.approval],
			};
		}
		selected.push(result.selected);
	}
	return { ok: true, selected };
}
