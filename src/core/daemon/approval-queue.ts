import { join, resolve } from "node:path";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { cloneEvidenceJsonObject } from "#core/evidence/policy.js";
import type { RiskLevel } from "#core/tools/guardrails.js";
import {
	type ApprovalExecutionDescriptor,
	createApprovalExecutionDescriptor,
	pendingApprovalMatchesExecutionDescriptor,
} from "./approval-execution-descriptor.js";
import { createPendingApproval } from "./approval-queue-create.js";
import { emitApprovalExpired, emitApprovalRequested, emitApprovalResolved } from "./approval-queue-events.js";
import { projectApprovalForClient } from "./approval-queue-projection.js";
import { defaultApprovalPendingTtlMs } from "./approval-queue-retention.js";
import { ApprovalQueueStore } from "./approval-queue-store.js";
import type {
	ApprovalClientProjection,
	ApprovalExecutionApprovalResult,
	ApprovalExecutionApproveAllResult,
	ApprovalExecutionSnapshotResult,
	ApprovalMcpPromptDeclaration,
	ApprovalStatus,
	PendingApproval,
	SelectedApprovalExecution,
} from "./approval-queue-types.js";
import { deriveDirectoryScopeId } from "./scope-registry.js";

export { isApprovalId, projectApprovalForClient } from "./approval-queue-projection.js";
export { defaultApprovalPendingTtlMs } from "./approval-queue-retention.js";
export type * from "./approval-queue-types.js";
export { isWorkflowStepApproval, WORKFLOW_STEP_APPROVAL_SOURCE } from "./approval-queue-types.js";
export type ApprovalInput = Record<string, unknown>;
export class ApprovalQueue {
	private pbus: ProjectScopedEventBus | null;
	private executionInputs = new Map<string, PendingApproval["input"]>();
	private reviewContexts = new Map<string, string>();
	private readonly scopeId: string;
	private readonly store: ApprovalQueueStore;
	constructor(dir: string, pbus?: ProjectScopedEventBus | null, scopeId?: string) {
		this.store = new ApprovalQueueStore(dir);
		this.pbus = pbus ?? null;
		this.scopeId = scopeId
			?? pbus?.getScopeId()
			?? deriveDirectoryScopeId(resolve(dir, "..", ".."));
		if (pbus && pbus.getScopeId() !== this.scopeId) {
			throw new Error(
				`ApprovalQueue scope ${this.scopeId} does not match event bus scope ${pbus.getScopeId()}`,
			);
		}
	}

	getScopeId(): string { return this.scopeId; }

	private belongsToQueue(item: PendingApproval): boolean { return item.scopeId === this.scopeId; }

	enqueue(
		tool: string,
		input: ApprovalInput,
		risk: RiskLevel,
		reason: string,
		source?: string,
		timeoutMs?: number,
		defaultResolution?: "deny" | "approve",
		context?: string,
		sessionId?: string,
		mcpPromptDeclaration?: ApprovalMcpPromptDeclaration,
	): PendingApproval {
		const item = createPendingApproval(
			this.scopeId,
			tool,
			input,
			risk,
			reason,
			source,
			timeoutMs,
			defaultResolution,
			context,
			sessionId,
			mcpPromptDeclaration,
		);
		this.executionInputs.set(item.id, cloneEvidenceJsonObject(input));
		if (context !== undefined) this.reviewContexts.set(item.id, context);
		const stored = this.store.write(item);
		emitApprovalRequested(this.pbus, stored, sessionId, this.count("pending"));
		return stored;
	}

	get(id: string): PendingApproval | null {
		return this.store.get(id);
	}

	list(status?: ApprovalStatus): PendingApproval[] {
		const items = this.store.list();
		const mismatched = items.find((item) => !this.belongsToQueue(item));
		if (mismatched) {
			throw new Error(
				`Approval ${mismatched.id} belongs to scope ${mismatched.scopeId}, not ${this.scopeId}`,
			);
		}
		return items
			.filter((item) => !status || item.status === status)
			.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.seq ?? 0) - (b.seq ?? 0));
	}

	projectForClient(item: PendingApproval): ApprovalClientProjection {
		return projectApprovalForClient(item, "daemon-api", this.executionInputs.get(item.id), this.reviewContexts.get(item.id));
	}

	private approveSelected(
		item: PendingApproval,
		note?: string,
		resolutionSource?: string,
		executionInput?: PendingApproval["input"],
		reviewContext?: string,
	): PendingApproval {
		item.status = "approved";
		item.resolvedAt = new Date().toISOString();
		if (note) item.approvalNote = note;
		if (resolutionSource) item.resolutionSource = resolutionSource;
		const stored = this.store.write(item);
		this.executionInputs.delete(item.id);
		this.reviewContexts.delete(item.id);
		emitApprovalResolved(this.pbus, stored, true, "", this.count("pending"));
		return executionInput === undefined
			? stored
			: {
				...stored,
				input: executionInput,
				...(reviewContext !== undefined ? { context: reviewContext } : {}),
			};
	}

	private selectForExecution(id: string):
		| { ok: true; selected: SelectedApprovalExecution }
		| {
				ok: false;
				reason: "not_found" | "input_unavailable" | "scope_mismatch";
				approval?: PendingApproval;
		  } {
		const item = this.get(id);
		if (!item || item.status !== "pending") return { ok: false, reason: "not_found" };
		if (!this.belongsToQueue(item)) {
			return { ok: false, reason: "scope_mismatch", approval: item };
		}
		const executionInput = this.executionInputs.get(id);
		if (executionInput === undefined) {
			return { ok: false, reason: "input_unavailable", approval: item };
		}
		const reviewContext = this.reviewContexts.get(id);
		if (item.contextRedaction !== undefined && reviewContext === undefined) {
			return { ok: false, reason: "input_unavailable", approval: item };
		}
		return {
			ok: true,
			selected: {
				approval: item,
				executionInput,
				...(reviewContext !== undefined ? { reviewContext } : {}),
				descriptor: createApprovalExecutionDescriptor(item, executionInput, reviewContext),
			},
		};
	}

	getExecutionSnapshot(id: string): ApprovalExecutionSnapshotResult {
		const result = this.selectForExecution(id);
		if (!result.ok) return result;
		return { ok: true, snapshot: { approval: result.selected.approval, descriptor: result.selected.descriptor } };
	}

	approveForExecution(
		descriptor: ApprovalExecutionDescriptor,
		note?: string,
		resolutionSource?: string,
	): ApprovalExecutionApprovalResult {
		const result = this.selectForExecution(descriptor.approvalId);
		if (!result.ok) return result;
		const { approval, executionInput, reviewContext } = result.selected;
		if (!pendingApprovalMatchesExecutionDescriptor(
			approval,
			executionInput,
			reviewContext,
			descriptor,
		)) {
			return { ok: false, reason: "descriptor_mismatch", approval };
		}
		const approved = this.approveSelected(
			approval,
			note,
			resolutionSource,
			executionInput,
			reviewContext,
		);
		return { ok: true, approval: approved };
	}

	reject(id: string, reason?: string, resolutionSource?: string): PendingApproval | null {
		const item = this.get(id);
		if (!item || item.status !== "pending" || !this.belongsToQueue(item)) return null;
		item.status = "rejected";
		item.resolvedAt = new Date().toISOString();
		item.rejectionReason = reason;
		if (resolutionSource) item.resolutionSource = resolutionSource;
		const stored = this.store.write(item);
		this.executionInputs.delete(id);
		this.reviewContexts.delete(id);
		emitApprovalResolved(this.pbus, stored, false, stored.rejectionReason ?? "", this.count("pending"));
		return stored;
	}

	expireStale(defaultTtlMs?: number): PendingApproval[] {
		const now = Date.now();
		const expired: PendingApproval[] = [];
		for (const item of this.list("pending")) {
			const ttl = item.timeoutMs ?? defaultTtlMs ?? defaultApprovalPendingTtlMs();
			if (now < new Date(item.createdAt).getTime() + ttl) continue;
			const resolution = item.defaultResolution ?? "deny";
			item.resolvedAt = new Date().toISOString();
			item.resolutionSource = "timeout";
			if (resolution === "approve") {
				item.status = "approved";
			} else {
				item.status = "expired";
				item.rejectionReason = "expired";
			}
			const stored = this.store.write(item);
			this.executionInputs.delete(item.id);
			this.reviewContexts.delete(item.id);
			emitApprovalExpired(this.pbus, stored, resolution, this.count("pending"));
			expired.push(stored);
		}
		return expired;
	}

	approvePendingForExecution(
		descriptors: readonly ApprovalExecutionDescriptor[],
		note?: string,
	): ApprovalExecutionApproveAllResult {
		const selected: SelectedApprovalExecution[] = [];
		for (const descriptor of descriptors) {
			const result = this.selectForExecution(descriptor.approvalId);
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
		const approvals = selected.map((item) => this.approveSelected(
			item.approval,
			note,
			undefined,
			item.executionInput,
			item.reviewContext,
		));
		return {
			ok: true,
			approvals,
		};
	}

	rejectAll(reason?: string): PendingApproval[] {
		return this.list("pending").map((item) => this.reject(item.id, reason)).filter(Boolean) as PendingApproval[];
	}

	count(status?: ApprovalStatus): number {
		return this.list(status).length;
	}

	clear(): void {
		this.store.clear();
		this.executionInputs.clear();
		this.reviewContexts.clear();
	}
}

let queueInstance: ApprovalQueue | null = null;

export function getApprovalQueue(dir?: string): ApprovalQueue {
	return queueInstance ??= new ApprovalQueue(dir ?? join(process.cwd(), ".kota", "approvals"));
}

// Project runtime bundle setup installs the default scope's queue instance here.
export function setApprovalQueueInstance(queue: ApprovalQueue): void { queueInstance = queue; }

export function resetApprovalQueue(): void { queueInstance = null; }
