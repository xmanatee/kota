import { join, resolve } from "node:path";
import type { ScopedEventBus } from "#core/events/scope.js";
import { cloneEvidenceJsonObject } from "#core/evidence/policy.js";
import type { RiskLevel } from "#core/tools/guardrails.js";
import type { ToolCallInput } from "#core/tools/guardrails-classify.js";
import { captureLocalToolApprovalDeclaration } from "#core/tools/local-tool-approval-binding.js";
import {
	type ApprovalExecutionDescriptor,
	pendingApprovalMatchesExecutionDescriptor,
} from "./approval-execution-descriptor.js";
import {
	type AuthenticatedApprovalExecutionTarget,
	authenticateApprovalForExecution,
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
	type ApprovalClockPort,
	type ApprovalExecutionApprovalResult,
	type ApprovalExecutionApproveAllResult,
	type ApprovalExecutionSnapshotResult,
	type ApprovalMcpPromptDeclaration,
	type ApprovalPersistencePort,
	type ApprovalStatus,
	type PendingApproval,
	type PendingWorkflowGateApproval,
	usesWorkflowGateIdentity,
	type WorkflowGateApprovalInput,
} from "./approval-queue-types.js";
import type { StoredApproval } from "./approval-record-repository.js";
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
	ApprovalClockPort,
	ApprovalExecutionApprovalResult,
	ApprovalExecutionApproveAllResult,
	ApprovalExecutionSnapshot,
	ApprovalExecutionSnapshotResult,
	ApprovalKind,
	ApprovalLocalToolDeclaration,
	ApprovalMcpPromptDeclaration,
	ApprovalPersistencePort,
	ApprovalStatus,
	ApprovalToolIoRedaction,
	PendingApproval,
	PendingToolApproval,
	PendingWorkflowGateApproval,
	StoredApproval,
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

export type ApprovalQueueOptions = {
	scopeId?: string;
	defaultTtlMs?: number;
	clock?: ApprovalClockPort;
	records?: ApprovalPersistencePort;
	storage?: ApprovalRecordStorage;
};

export class ApprovalQueue {
	private pbus: ScopedEventBus | null;
	private executionInputs = new Map<string, PendingApproval["input"]>();
	private reviewContexts = new Map<string, string>();
	private readonly scopeId: string;
	private readonly defaultTtlMs: number;
	private readonly clock: ApprovalClockPort;
	private readonly records: ApprovalPersistencePort;
	private readonly resolutionAuthenticator = new ApprovalResolutionAuthenticator();

	constructor(
		dir: string,
		pbus?: ScopedEventBus | null,
		options: ApprovalQueueOptions = {},
	) {
		this.clock = options.clock ?? { now: () => new Date() };
		this.pbus = pbus ?? null;
		if (options.records) {
			this.records = options.records;
			this.scopeId = options.scopeId ?? pbus?.getScopeId() ?? "default";
		} else {
			const storage = options.storage ?? new ApprovalRecordStorage(dir);
			this.scopeId = options.scopeId
				?? pbus?.getScopeId()
				?? deriveDirectoryScopeId(resolve(storage.directoryPath, "..", ".."));
			this.records = new ApprovalRecordRepository(storage, this.scopeId);
		}
		this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_APPROVAL_PENDING_TTL_MS;
		if (pbus && pbus.getScopeId() !== this.scopeId) {
			throw new Error(
				`ApprovalQueue scope ${this.scopeId} does not match event bus scope ${pbus.getScopeId()}`,
			);
		}
	}

	getScopeId(): string {
		return this.scopeId;
	}

	getClock(): ApprovalClockPort {
		return this.clock;
	}

	getPersistence(): ApprovalPersistencePort {
		return this.records;
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
		const nowIso = this.clock.now().toISOString();
		const item = input.kind === "workflow_gate"
			? createPendingApproval({
				...input,
				createdAt: input.createdAt ?? nowIso,
				input: { ...input.input },
			})
			: createPendingApproval({
				...input,
				createdAt: input.createdAt ?? nowIso,
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
		const authenticated = authenticateApprovalForExecution(
			this.records.read(id),
			this.scopeId,
			this.resolutionAuthenticator,
		);
		if (!authenticated.ok) return authenticated;
		if (this.isStale(
			authenticated.target.approval,
			this.clock.now().getTime(),
			this.defaultTtlMs,
		)) {
			this.expireAuthenticated(authenticated.target);
			return { ok: false, reason: "not_found" } as const;
		}
		return selectApprovalForExecution(
			authenticated.target,
			this.executionInputs,
			this.reviewContexts,
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
		item.resolvedAt = this.clock.now().toISOString();
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
		item.resolvedAt = this.clock.now().toISOString();
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

	expire(id: string, resolutionSource = "timeout"): PendingApproval | null {
		const current = this.records.read(id);
		if (!current || current.item.status !== "pending" || current.item.scopeId !== this.scopeId) {
			return null;
		}
		const approval = this.resolutionAuthenticator.authenticatePending(current.item);
		return this.expireAuthenticated(
			{
				approval,
				recordIdentity: current.identity,
			},
			resolutionSource,
		);
	}

	private isStale(
		item: PendingApproval,
		now: number,
		defaultTtlMs: number,
	): boolean {
		const ttl = item.timeoutMs ?? defaultTtlMs;
		return now >= new Date(item.createdAt).getTime() + ttl;
	}

	private expireAuthenticated(
		target: AuthenticatedApprovalExecutionTarget,
		resolutionSource = "timeout",
	): PendingApproval {
		const item = target.approval;
		const resolution = expireApproval(
			item,
			this.clock.now().toISOString(),
			resolutionSource,
		);
		const stored = this.resolutionAuthenticator.write(
			this.records,
			item,
			target.recordIdentity,
		);
		this.executionInputs.delete(item.id);
		this.reviewContexts.delete(item.id);
		emitApprovalExpired(this.pbus, stored, resolution, this.count("pending"));
		return stored;
	}

	private expireStored(current: StoredApproval): PendingApproval {
		const approval = this.resolutionAuthenticator.authenticatePending(current.item);
		return this.expireAuthenticated({
			approval,
			recordIdentity: current.identity,
		});
	}

	expireStale(defaultTtlMs?: number): ApprovalExpirationSweepResult {
		const now = this.clock.now().getTime();
		const effectiveDefaultTtlMs = defaultTtlMs ?? this.defaultTtlMs;
		const expired: PendingApproval[] = [];
		const blocked: ApprovalExpirationSweepResult["blocked"] = [];
		for (const current of this.records.list("pending")) {
			if (!this.isStale(current.item, now, effectiveDefaultTtlMs)) continue;
			try {
				expired.push(this.expireStored(current));
			} catch (error) {
				if (!(error instanceof ApprovalResolutionIntegrityError)) throw error;
				blocked.push({
					approvalId: current.item.id,
					reason: "pending_integrity_unavailable",
				});
			}
		}
		return { expired, blocked };
	}

	approvePendingForExecution(
		descriptors: readonly ApprovalExecutionDescriptor[],
		note?: string,
	): ApprovalExecutionApproveAllResult {
		const selections = descriptors.map(({ approvalId }) =>
			this.selectForExecution(approvalId));
		const result = selectApprovalsForExecution(descriptors, selections);
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

// Scope runtime bundle setup installs the default scope's queue instance here.
export function setApprovalQueueInstance(queue: ApprovalQueue): void {
	queueInstance = queue;
}

export function resetApprovalQueue(): void {
	queueInstance = null;
}
