import { join } from "node:path";
import { approvalFilePath, projectApprovalForStorage } from "./approval-queue-projection.js";
import {
	type ApprovalStatus,
	type PendingApproval,
	usesWorkflowGateIdentity,
} from "./approval-queue-types.js";
import type {
	ApprovalFileIdentity,
	ApprovalRecordSnapshot,
	ApprovalRecordStorage,
} from "./approval-record-storage.js";

export type StoredApproval = {
	item: PendingApproval;
	identity: ApprovalFileIdentity;
};

export class ApprovalRecordRepository {
	constructor(
		private readonly storage: ApprovalRecordStorage,
		private readonly scopeId: string,
	) {}

	read(id: string): StoredApproval | null {
		if (!approvalFilePath(this.storage.directoryPath, id)) return null;
		const snapshot = this.storage.read(`${id}.json`);
		return snapshot === null ? null : { item: this.parse(snapshot), identity: snapshot.identity };
	}

	list(status?: ApprovalStatus): StoredApproval[] {
		const stored = this.storage.list().map((snapshot) => ({
			item: this.parse(snapshot),
			identity: snapshot.identity,
		}));
		const mismatched = stored.find(({ item }) => item.scopeId !== this.scopeId);
		if (mismatched) {
			throw new Error(
				`Approval ${mismatched.item.id} belongs to scope ${mismatched.item.scopeId}, not ${this.scopeId}`,
			);
		}
		return stored
			.filter(({ item }) => !status || item.status === status)
			.sort(({ item: left }, { item: right }) =>
				left.createdAt.localeCompare(right.createdAt) || (left.seq ?? 0) - (right.seq ?? 0));
	}

	write(item: PendingApproval, expectedIdentity: ApprovalFileIdentity | null): PendingApproval {
		const projected = projectApprovalForStorage(item);
		if (!approvalFilePath(this.storage.directoryPath, projected.id)) {
			throw new Error(`Malformed approval id: ${projected.id}`);
		}
		this.storage.write(`${projected.id}.json`, JSON.stringify(projected, null, 2), expectedIdentity);
		return projected;
	}

	clear(): void {
		this.storage.clear();
	}

	private parse(snapshot: ApprovalRecordSnapshot): PendingApproval {
		const path = join(this.storage.directoryPath, snapshot.filename);
		const item = JSON.parse(snapshot.contents) as PendingApproval;
		if (`${item.id}.json` !== snapshot.filename) {
			throw new Error(`Malformed approval record at ${path}: id does not match filename`);
		}
		if (typeof item.scopeId !== "string" || item.scopeId.length === 0) {
			throw new Error(`Malformed approval record at ${path}: missing scopeId`);
		}
		if (item.kind !== "tool_call" && item.kind !== "workflow_gate") {
			throw new Error(`Malformed approval record at ${path}: invalid approval kind`);
		}
		if (
			item.kind === "tool_call"
			&& usesWorkflowGateIdentity(item.tool, item.source)
		) {
			throw new Error(
				`Malformed approval record at ${path}: invalid tool-call approval identity`,
			);
		}
		if (item.kind === "workflow_gate") {
			const input = item.input;
			const inputKeys = typeof input === "object"
				&& input !== null
				&& !Array.isArray(input)
				? Object.keys(input)
				: [];
			if (
				item.source !== "workflow-step"
				|| item.mcpPromptDeclaration !== undefined
				|| inputKeys.length !== 3
				|| !inputKeys.every((key) =>
					key === "workflowName" || key === "runId" || key === "stepId")
				|| typeof input.workflowName !== "string"
				|| input.workflowName.length === 0
				|| typeof input.runId !== "string"
				|| input.runId.length === 0
				|| typeof input.stepId !== "string"
				|| input.stepId.length === 0
				|| item.tool !== `workflow-approval/${input.workflowName}/${input.stepId}`
			) {
				throw new Error(`Malformed approval record at ${path}: invalid workflow gate`);
			}
		}
		return projectApprovalForStorage(item);
	}
}
