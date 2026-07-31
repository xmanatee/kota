import { join, resolve } from "node:path";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { cloneEvidenceJsonObject } from "#core/evidence/policy.js";
import type { RiskLevel } from "#core/tools/guardrails.js";
import type { ToolCallInput } from "#core/tools/guardrails-classify.js";
import { captureLocalToolApprovalDeclaration } from "#core/tools/local-tool-approval-binding.js";
import {
	type ApprovalExecutionDescriptor,
	pendingApprovalMatchesExecutionDescriptor,
} from "./approval-execution-descriptor.js";
import {
	selectApprovalForExecution,
	selectApprovalsForExecution,
} from "./approval-execution-selection.js";
import { emitApprovalExpired, emitApprovalRequested, emitApprovalResolved } from "./approval-queue-events.js";
import {
	DEFAULT_APPROVAL_PENDING_TTL_MS,
	expireApproval,
} from "./approval-queue-expiration-policy.js";
import {
	createPendingApproval,
	type PendingApprovalInput,
} from "./approval-queue-item.js";
import { projectApprovalForClient } from "./approval-queue-projection.js";
import {
	type ApprovalClientProjection,
	type ApprovalExecutionApprovalResult,
	type ApprovalExecutionApproveAllResult,
	type ApprovalExecutionSnapshotResult,
	type ApprovalMcpPromptDeclaration,
	type ApprovalStatus,
	type PendingApproval,
	type PendingWorkflowGateApproval,
	usesWorkflowGateIdentity,
	type WorkflowGateApprovalInput,
} from "./approval-queue-types.js";
import { ApprovalRecordRepository } from "./approval-record-repository.js";
import { type ApprovalFileIdentity, ApprovalRecordStorage } from "./approval-record-storage.js";
import {
	ApprovalResolutionAuthenticator,
	ApprovalResolutionIntegrityError,
} from "./approval-resolution-integrity.js";
import { deriveDirectoryScopeId } from "./scope-registry.js";

export { defaultApprovalPendingTtlMs } from "./approval-queue-expiration-policy.js";
export { isApprovalId, projectApprovalForClient } from "./approval-queue-projection.js";
export type {
	ApprovalClientProjection,
	ApprovalExecutionApprovalResult,
	ApprovalExecutionApproveAllResult,
	ApprovalExecutionSnapshot,
	ApprovalExecutionSnapshotResult,
	ApprovalKind,
	ApprovalLocalToolDeclaration,
	ApprovalMcpPromptDeclaration,
	ApprovalStatus,
	ApprovalToolIoRedaction,
	PendingApproval,
	PendingToolApproval,
	PendingWorkflowGateApproval,
	WorkflowGateApprovalInput,
} from "./approval-queue-types.js";
export { isWorkflowGateApproval, WORKFLOW_STEP_APPROVAL_SOURCE } from "./approval-queue-types.js";

export type WorkflowGateApprovalRequest = WorkflowGateApprovalInput & {
	reason: string;
	timeoutMs?: number;
	defaultResolution?: "deny" | "approve";
};

export type ApprovalExpirationSweepResult = {
	expired: PendingApproval[];
	blocked: Array<{
		approvalId: string;
		reason: "pending_integrity_unavailable";
	}>;
};

export class ApprovalQueue {
	private pbus: ProjectScopedEventBus | null;
	private executionInputs = new Map<string, PendingApproval["input"]>();
	private reviewContexts = new Map<string, string>();
	private readonly scopeId: string;
	private readonly records: ApprovalRecordRepository;
	private readonly resolutionAuthenticator = new ApprovalResolutionAuthenticator();

	constructor(
		dir: string,
		pbus?: ProjectScopedEventBus | null,
		scopeId?: string,
	) {
		const storage = new ApprovalRecordStorage(dir);
		this.pbus = pbus ?? null;
		this.scopeId = scopeId
			?? pbus?.getScopeId()
			?? deriveDirectoryScopeId(resolve(storage.directoryPath, "..", ".."));
		this.records = new ApprovalRecordRepository(storage, this.scopeId);
		if (pbus && pbus.getScopeId() !== this.scopeId) {
			throw new Error(
				`ApprovalQueue scope ${this.scopeId} does not match event bus scope ${pbus.getScopeId()}`,
			);
		}
	}

	getScopeId(): string {
		return this.scopeId;
	}

	enqueue(
		tool: string,
		input: ToolCallInput,
		risk: RiskLevel,
		reason: string,
		source?: string,
		timeoutMs?: number,
		defaultResolution?: "deny" | "approve",
		context?: string,
		sessionId?: string,
		mcpPromptDeclaration?: ApprovalMcpPromptDeclaration,
	): PendingApproval {
		if (usesWorkflowGateIdentity(tool, source)) {
			throw new Error(
				"Workflow gate approval identities must be enqueued with enqueueWorkflowGate",
			);
		}
		return this.enqueueItem({
			kind: "tool_call",
			scopeId: this.scopeId,
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
			localToolDeclaration: captureLocalToolApprovalDeclaration(tool, input),
		});
	}

	enqueueWorkflowGate(
		request: WorkflowGateApprovalRequest,
	): PendingWorkflowGateApproval {
		const input: WorkflowGateApprovalInput = {
			workflowName: request.workflowName,
			runId: request.runId,
			stepId: request.stepId,
		};
		return this.enqueueItem({
			kind: "workflow_gate",
			scopeId: this.scopeId,
			tool: `workflow-approval/${request.workflowName}/${request.stepId}`,
			input,
			risk: "moderate",
			reason: request.reason,
			source: "workflow-step",
			timeoutMs: request.timeoutMs,
			defaultResolution: request.defaultResolution,
		}) as PendingWorkflowGateApproval;
	}

	private enqueueItem(input: PendingApprovalInput): PendingApproval {
		const item = input.kind === "workflow_gate"
			? createPendingApproval({ ...input, input: { ...input.input } })
			: createPendingApproval({
				...input,
				input: cloneEvidenceJsonObject(input.input),
			});
		const executionInput = item.input;
		this.executionInputs.set(item.id, executionInput);
		if (input.context !== undefined) this.reviewContexts.set(item.id, input.context);
		let stored: PendingApproval;
		try {
			stored = this.records.write(item, null);
			this.resolutionAuthenticator.registerPending(stored);
		} catch (error) {
			this.executionInputs.delete(item.id);
			this.reviewContexts.delete(item.id);
			throw error;
		}
		emitApprovalRequested(this.pbus, stored, input.sessionId, this.count("pending"));
		return stored;
	}

	get(id: string): PendingApproval | null {
		return this.records.read(id)?.item ?? null;
	}

	getWithAuthenticatedResolution(id: string): PendingApproval | null {
		return this.resolutionAuthenticator.read(this.records, id);
	}

	list(status?: ApprovalStatus): PendingApproval[] {
		return this.records.list(status).map(({ item }) => item);
	}

	projectForClient(item: PendingApproval): ApprovalClientProjection {
		return projectApprovalForClient(
			item,
			"daemon-api",
			this.executionInputs.get(item.id),
			this.reviewContexts.get(item.id),
		);
	}

	private selectForExecution(id: string) {
		return selectApprovalForExecution(
			this.records,
			this.executionInputs,
			this.reviewContexts,
			this.scopeId,
			id,
			this.resolutionAuthenticator,
		);
	}

	private approveSelected(
		item: PendingApproval,
		recordIdentity: ApprovalFileIdentity,
		note?: string,
		resolutionSource?: string,
		executionInput?: PendingApproval["input"],
		reviewContext?: string,
	): PendingApproval {
		item.status = "approved";
		item.resolvedAt = new Date().toISOString();
		if (note) item.approvalNote = note;
		if (resolutionSource) item.resolutionSource = resolutionSource;
		const stored = this.resolutionAuthenticator.write(
			this.records,
			item,
			recordIdentity,
		);
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

	getExecutionSnapshot(id: string): ApprovalExecutionSnapshotResult {
		const result = this.selectForExecution(id);
		if (!result.ok) return result;
		return {
			ok: true,
			snapshot: {
				approval: result.selected.approval,
				descriptor: result.selected.descriptor,
				executionInput: result.selected.executionInput,
			},
		};
	}

	approveForExecution(
		descriptor: ApprovalExecutionDescriptor,
		note?: string,
		resolutionSource?: string,
	): ApprovalExecutionApprovalResult {
		const result = this.selectForExecution(descriptor.approvalId);
		if (!result.ok) return result;
		const {
			approval,
			executionInput,
			recordIdentity,
			reviewContext,
		} = result.selected;
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
			recordIdentity,
			note,
			resolutionSource,
			executionInput,
			reviewContext,
		);
		return { ok: true, approval: approved };
	}

	reject(id: string, reason?: string, resolutionSource?: string): PendingApproval | null {
		const current = this.records.read(id);
		if (!current || current.item.status !== "pending" || current.item.scopeId !== this.scopeId) return null;
		const item = current.item;
		item.status = "rejected";
		item.resolvedAt = new Date().toISOString();
		item.rejectionReason = reason;
		if (resolutionSource) item.resolutionSource = resolutionSource;
		const stored = this.resolutionAuthenticator.write(
			this.records,
			item,
			current.identity,
		);
		this.executionInputs.delete(id);
		this.reviewContexts.delete(id);
		emitApprovalResolved(this.pbus, stored, false, stored.rejectionReason ?? "", this.count("pending"));
		return stored;
	}

	expireStale(defaultTtlMs?: number): ApprovalExpirationSweepResult {
		const now = Date.now();
		const expired: PendingApproval[] = [];
		const blocked: ApprovalExpirationSweepResult["blocked"] = [];
		for (const current of this.records.list("pending")) {
			const ttl = current.item.timeoutMs
				?? defaultTtlMs
				?? DEFAULT_APPROVAL_PENDING_TTL_MS;
			if (now < new Date(current.item.createdAt).getTime() + ttl) continue;
			let item: PendingApproval;
			try {
				item = this.resolutionAuthenticator.authenticatePending(current.item);
			} catch (error) {
				if (!(error instanceof ApprovalResolutionIntegrityError)) throw error;
				blocked.push({
					approvalId: current.item.id,
					reason: "pending_integrity_unavailable",
				});
				continue;
			}
			const resolution = expireApproval(item);
			const stored = this.resolutionAuthenticator.write(
				this.records,
				item,
				current.identity,
			);
			this.executionInputs.delete(item.id);
			this.reviewContexts.delete(item.id);
			emitApprovalExpired(this.pbus, stored, resolution, this.count("pending"));
			expired.push(stored);
		}
		return { expired, blocked };
	}

	approvePendingForExecution(
		descriptors: readonly ApprovalExecutionDescriptor[],
		note?: string,
	): ApprovalExecutionApproveAllResult {
		const result = selectApprovalsForExecution(
			this.records,
			this.executionInputs,
			this.reviewContexts,
			this.scopeId,
			descriptors,
			this.resolutionAuthenticator,
		);
		if (!result.ok) return result;
		const approvals = result.selected.map((item) => this.approveSelected(
			item.approval,
			item.recordIdentity,
			note,
			undefined,
			item.executionInput,
			item.reviewContext,
		));
		return { ok: true, approvals };
	}

	rejectAll(reason?: string): PendingApproval[] {
		return this.list("pending")
			.map((item) => this.reject(item.id, reason))
			.filter((item): item is PendingApproval => item !== null);
	}

	count(status?: ApprovalStatus): number {
		return this.list(status).length;
	}

	clear(): void {
		this.records.clear();
		this.executionInputs.clear();
		this.reviewContexts.clear();
		this.resolutionAuthenticator.clear();
	}
}

let queueInstance: ApprovalQueue | null = null;

export function getApprovalQueue(dir?: string): ApprovalQueue {
	return queueInstance ??= new ApprovalQueue(dir ?? join(process.cwd(), ".kota", "approvals"));
}

// Project runtime bundle setup installs the default scope's queue instance here.
export function setApprovalQueueInstance(queue: ApprovalQueue): void {
	queueInstance = queue;
}

export function resetApprovalQueue(): void {
	queueInstance = null;
}
