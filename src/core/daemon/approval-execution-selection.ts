import {
	type ApprovalExecutionDescriptor,
	createApprovalExecutionDescriptor,
	pendingApprovalMatchesExecutionDescriptor,
} from "./approval-execution-descriptor.js";
import type { ApprovalExecutionSnapshot, PendingApproval } from "./approval-queue-types.js";
import type { ApprovalRecordRepository } from "./approval-record-repository.js";
import type { ApprovalFileIdentity } from "./approval-record-storage.js";

export type SelectedApprovalExecution = ApprovalExecutionSnapshot & {
	executionInput: PendingApproval["input"];
	recordIdentity: ApprovalFileIdentity;
};

export type ApprovalExecutionSelectionResult =
	| { ok: true; selected: SelectedApprovalExecution }
	| {
			ok: false;
			reason: "not_found" | "input_unavailable" | "scope_mismatch";
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
	scopeId: string,
	id: string,
): ApprovalExecutionSelectionResult {
	const stored = records.read(id);
	if (!stored || stored.item.status !== "pending") return { ok: false, reason: "not_found" };
	if (stored.item.scopeId !== scopeId) {
		return { ok: false, reason: "scope_mismatch", approval: stored.item };
	}
	const executionInput = executionInputs.get(id);
	if (executionInput === undefined) {
		return { ok: false, reason: "input_unavailable", approval: stored.item };
	}
	return {
		ok: true,
		selected: {
			approval: stored.item,
			executionInput,
			descriptor: createApprovalExecutionDescriptor(stored.item, executionInput),
			recordIdentity: stored.identity,
		},
	};
}

export function selectApprovalsForExecution(
	records: ApprovalRecordRepository,
	executionInputs: ReadonlyMap<string, PendingApproval["input"]>,
	scopeId: string,
	descriptors: readonly ApprovalExecutionDescriptor[],
): ApprovalExecutionBulkSelectionResult {
	const selected: SelectedApprovalExecution[] = [];
	for (const descriptor of descriptors) {
		const result = selectApprovalForExecution(records, executionInputs, scopeId, descriptor.approvalId);
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
