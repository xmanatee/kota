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
import type { StoredApproval } from "./approval-record-repository.js";
import type { ApprovalFileIdentity } from "./approval-record-storage.js";
import {
	type ApprovalResolutionAuthenticator,
	ApprovalResolutionIntegrityError,
} from "./approval-resolution-integrity.js";

export type AuthenticatedApprovalExecutionTarget = {
	approval: PendingApproval;
	recordIdentity: ApprovalFileIdentity;
};

export type SelectedApprovalExecution = ApprovalExecutionSnapshot & {
	reviewContext?: string;
	recordIdentity: ApprovalFileIdentity;
};

type ApprovalExecutionSelectionFailure = {
	ok: false;
	reason:
		| "not_found"
		| "input_unavailable"
		| "scope_mismatch"
		| "descriptor_mismatch";
	approval?: PendingApproval;
};

export type ApprovalExecutionAuthenticationResult =
	| { ok: true; target: AuthenticatedApprovalExecutionTarget }
	| ApprovalExecutionSelectionFailure;

export type ApprovalExecutionSelectionResult =
	| { ok: true; selected: SelectedApprovalExecution }
	| ApprovalExecutionSelectionFailure;

export type ApprovalExecutionBulkSelectionResult =
	| { ok: true; selected: SelectedApprovalExecution[] }
	| {
			ok: false;
			reason: "input_unavailable" | "scope_mismatch" | "descriptor_mismatch";
			approvals: PendingApproval[];
	  };

export function authenticateApprovalForExecution(
	stored: StoredApproval | null,
	scopeId: string,
	authenticator: ApprovalResolutionAuthenticator,
): ApprovalExecutionAuthenticationResult {
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
	return {
		ok: true,
		target: {
			approval,
			recordIdentity: stored.identity,
		},
	};
}

export function selectApprovalForExecution(
	target: AuthenticatedApprovalExecutionTarget,
	executionInputs: ReadonlyMap<string, PendingApproval["input"]>,
	reviewContexts: ReadonlyMap<string, string>,
): ApprovalExecutionSelectionResult {
	const { approval, recordIdentity } = target;
	const id = approval.id;
	const executionInput = executionInputs.get(id)
		?? (isWorkflowGateApproval(approval) ? approval.input : undefined);
	if (executionInput === undefined) {
		return { ok: false, reason: "input_unavailable", approval };
	}
	const reviewContext = reviewContexts.get(id);
	if (approval.contextRedaction !== undefined && reviewContext === undefined) {
		return { ok: false, reason: "input_unavailable", approval };
	}
	return {
		ok: true,
		selected: {
			approval,
			executionInput,
			...(reviewContext !== undefined ? { reviewContext } : {}),
			descriptor: createApprovalExecutionDescriptor(approval, executionInput, reviewContext),
			recordIdentity,
		},
	};
}

export function selectApprovalsForExecution(
	descriptors: readonly ApprovalExecutionDescriptor[],
	selections: readonly ApprovalExecutionSelectionResult[],
): ApprovalExecutionBulkSelectionResult {
	if (selections.length !== descriptors.length) {
		throw new Error("Approval execution descriptors and selections must have matching lengths");
	}
	const selected: SelectedApprovalExecution[] = [];
	for (let index = 0; index < descriptors.length; index += 1) {
		const descriptor = descriptors[index];
		const result = selections[index];
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
