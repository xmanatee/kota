import { cloneEvidenceJsonObject } from "#core/evidence/policy.js";
import {
	type ApprovalExecutionDescriptor,
	createApprovalExecutionDescriptor,
	pendingApprovalMatchesExecutionDescriptor,
} from "./approval-execution-descriptor.js";
import type {
	ApprovalExecutionApprovalResult,
	ApprovalExecutionApproveAllResult,
	ApprovalExecutionSnapshot,
	ApprovalExecutionSnapshotResult,
	PendingApproval,
} from "./approval-queue-types.js";

type SelectedApprovalExecution = ApprovalExecutionSnapshot & {
	executionInput: PendingApproval["input"];
};

type ApprovalQueueExecutionAccess = {
	get: (id: string) => PendingApproval | null;
	belongsToQueue: (item: PendingApproval) => boolean;
	listPending: () => PendingApproval[];
	approveSelected: (
		item: PendingApproval,
		note?: string,
		resolutionSource?: string,
		executionInput?: PendingApproval["input"],
	) => PendingApproval;
};

export class ApprovalQueueExecutionState {
	private executionInputs = new Map<string, PendingApproval["input"]>();

	constructor(private readonly access: ApprovalQueueExecutionAccess) {}

	rememberInput(id: string, input: PendingApproval["input"]): void {
		this.executionInputs.set(id, cloneEvidenceJsonObject(input));
	}

	inputFor(id: string): PendingApproval["input"] | undefined {
		return this.executionInputs.get(id);
	}

	forgetInput(id: string): void {
		this.executionInputs.delete(id);
	}

	clear(): void {
		this.executionInputs.clear();
	}

	private select(id: string):
		| { ok: true; selected: SelectedApprovalExecution }
		| {
				ok: false;
				reason: "not_found" | "input_unavailable" | "scope_mismatch";
				approval?: PendingApproval;
		  } {
		const item = this.access.get(id);
		if (!item || item.status !== "pending") return { ok: false, reason: "not_found" };
		if (!this.access.belongsToQueue(item)) {
			return { ok: false, reason: "scope_mismatch", approval: item };
		}
		const executionInput = this.executionInputs.get(id);
		if (executionInput === undefined) {
			return { ok: false, reason: "input_unavailable", approval: item };
		}
		return {
			ok: true,
			selected: {
				approval: item,
				executionInput,
				descriptor: createApprovalExecutionDescriptor(item, executionInput),
			},
		};
	}

	getSnapshot(id: string): ApprovalExecutionSnapshotResult {
		const result = this.select(id);
		if (!result.ok) return result;
		return {
			ok: true,
			snapshot: {
				approval: result.selected.approval,
				descriptor: result.selected.descriptor,
			},
		};
	}

	approve(
		descriptor: ApprovalExecutionDescriptor,
		note?: string,
		resolutionSource?: string,
	): ApprovalExecutionApprovalResult {
		const result = this.select(descriptor.approvalId);
		if (!result.ok) return result;
		const { approval, executionInput } = result.selected;
		if (!pendingApprovalMatchesExecutionDescriptor(approval, executionInput, descriptor)) {
			return { ok: false, reason: "descriptor_mismatch", approval };
		}
		return {
			ok: true,
			approval: this.access.approveSelected(
				approval,
				note,
				resolutionSource,
				executionInput,
			),
		};
	}

	approveAll(note?: string): ApprovalExecutionApproveAllResult {
		const snapshots: ApprovalExecutionSnapshot[] = [];
		for (const item of this.access.listPending()) {
			const result = this.getSnapshot(item.id);
			if (!result.ok) {
				return {
					ok: false,
					reason: result.reason === "not_found" ? "descriptor_mismatch" : result.reason,
					approvals: result.approval ? [result.approval] : [],
				};
			}
			snapshots.push(result.snapshot);
		}
		return this.approvePending(
			snapshots.map((snapshot) => snapshot.descriptor),
			note,
		);
	}

	approvePending(
		descriptors: readonly ApprovalExecutionDescriptor[],
		note?: string,
	): ApprovalExecutionApproveAllResult {
		const selected: SelectedApprovalExecution[] = [];
		for (const descriptor of descriptors) {
			const result = this.select(descriptor.approvalId);
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
		return {
			ok: true,
			approvals: selected.map((item) =>
				this.access.approveSelected(
					item.approval,
					note,
					undefined,
					item.executionInput,
				),
			),
		};
	}
}
