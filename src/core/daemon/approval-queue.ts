import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { cloneEvidenceJsonObject, evidenceRetentionDurationMsFor } from "#core/evidence/policy.js";
import type { RiskLevel } from "#core/tools/guardrails.js";
import { emitApprovalExpired, emitApprovalRequested, emitApprovalResolved } from "./approval-queue-events.js";
import { approvalFilePath, approvalFilePathForItem, projectApprovalForStorage } from "./approval-queue-projection.js";
import { deriveDirectoryScopeId } from "./scope-registry.js";

export { isApprovalId, projectApprovalForClient } from "./approval-queue-projection.js";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export type ApprovalToolIoRedaction = {
	redacted: true;
	reason: "tool-io";
	bytes?: number;
};

export type ApprovalMcpPromptDeclaration = {
	server: string;
	tool: string;
	promptDeclarationFingerprint: string;
	serverTransportIdentityFingerprint: string;
};

export type PendingApproval = {
	id: string;
	seq?: number;
	scopeId: string;
	tool: string;
	input: Record<string, unknown>;
	risk: RiskLevel;
	reason: string;
	source?: string;
	sessionId?: string;
	/** Last N agent conversation turns captured at enqueue time, for operator context. */
	context?: string;
	contextRedaction?: ApprovalToolIoRedaction;
	createdAt: string;
	status: ApprovalStatus;
	resolvedAt?: string;
	rejectionReason?: string;
	approvalNote?: string;
	mcpPromptDeclaration?: ApprovalMcpPromptDeclaration;
	timeoutMs?: number;
	defaultResolution?: "deny" | "approve";
	resolutionSource?: string;
};

export type ApprovalClientProjection = PendingApproval & {
	contextRedaction?: ApprovalToolIoRedaction;
};

export type ApprovalExecutionApprovalResult =
	| {
			ok: true;
			approval: PendingApproval;
	  }
	| {
			ok: false;
			reason: "not_found" | "input_unavailable" | "scope_mismatch";
			approval?: PendingApproval;
	  };

export type ApprovalExecutionApproveAllResult =
	| {
			ok: true;
			approvals: PendingApproval[];
	  }
	| {
			ok: false;
			reason: "input_unavailable" | "scope_mismatch";
			approvals: PendingApproval[];
	  };

const DEFAULT_APPROVAL_PENDING_TTL_MS = evidenceRetentionDurationMsFor({
	artifactType: "approval",
	state: "pending",
	scope: "directory",
});

export function defaultApprovalPendingTtlMs(): number {
	return DEFAULT_APPROVAL_PENDING_TTL_MS;
}

let _enqueueSeq = 0;

export class ApprovalQueue {
	private pbus: ProjectScopedEventBus | null;
	private executionInputs = new Map<string, PendingApproval["input"]>();
	private readonly scopeId: string;

	constructor(
		private dir: string,
		pbus?: ProjectScopedEventBus | null,
		scopeId?: string,
	) {
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
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

	getScopeId(): string {
		return this.scopeId;
	}

	private read(path: string): PendingApproval {
		const item = JSON.parse(readFileSync(path, "utf-8")) as PendingApproval;
		if (typeof item.scopeId !== "string" || item.scopeId.length === 0) {
			throw new Error(`Malformed approval record at ${path}: missing scopeId`);
		}
		return projectApprovalForStorage(item);
	}

	private belongsToQueue(item: PendingApproval): boolean {
		return item.scopeId === this.scopeId;
	}

	private write(item: PendingApproval): PendingApproval {
		const projected = projectApprovalForStorage(item);
		writeFileSync(
			approvalFilePathForItem(this.dir, projected),
			JSON.stringify(projected, null, 2),
		);
		return projected;
	}

	enqueue(
		tool: string,
		input: Record<string, unknown>,
		risk: RiskLevel,
		reason: string,
		source?: string,
		timeoutMs?: number,
		defaultResolution?: "deny" | "approve",
		context?: string,
		sessionId?: string,
		mcpPromptDeclaration?: ApprovalMcpPromptDeclaration,
	): PendingApproval {
		const item: PendingApproval = {
			id: randomUUID().slice(0, 8),
			seq: _enqueueSeq++,
			scopeId: this.scopeId,
			tool,
			input,
			risk,
			reason,
			source,
			...(sessionId !== undefined && { sessionId }),
			...(context !== undefined && { context }),
			...(mcpPromptDeclaration !== undefined && { mcpPromptDeclaration }),
			createdAt: new Date().toISOString(),
			status: "pending",
			...(timeoutMs !== undefined && { timeoutMs }),
			...(defaultResolution !== undefined && { defaultResolution }),
		};
		this.executionInputs.set(item.id, cloneEvidenceJsonObject(input));
		const stored = this.write(item);
		emitApprovalRequested(this.pbus, stored, sessionId, this.count("pending"));
		return stored;
	}

	get(id: string): PendingApproval | null {
		const path = approvalFilePath(this.dir, id);
		if (!path) return null;
		if (!existsSync(path)) return null;
		return this.read(path);
	}

	list(status?: ApprovalStatus): PendingApproval[] {
		if (!existsSync(this.dir)) return [];
		const items = readdirSync(this.dir)
			.filter((f) => f.endsWith(".json"))
			.map((f) => this.read(join(this.dir, f)));
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

	approve(id: string, note?: string, resolutionSource?: string): PendingApproval | null {
		const path = approvalFilePath(this.dir, id);
		if (!path) return null;
		const item = this.get(id);
		if (!item || item.status !== "pending" || !this.belongsToQueue(item)) return null;
		item.status = "approved";
		item.resolvedAt = new Date().toISOString();
		if (note) item.approvalNote = note;
		if (resolutionSource) item.resolutionSource = resolutionSource;
		const stored = this.write(item);
		const executionInput = this.executionInputs.get(id);
		this.executionInputs.delete(id);
		emitApprovalResolved(this.pbus, stored, true, "", this.count("pending"));
		return executionInput === undefined ? stored : { ...stored, input: executionInput };
	}

	approveForExecution(
		id: string,
		note?: string,
		resolutionSource?: string,
	): ApprovalExecutionApprovalResult {
		const item = this.get(id);
		if (!item || item.status !== "pending") return { ok: false, reason: "not_found" };
		if (!this.belongsToQueue(item)) {
			return { ok: false, reason: "scope_mismatch", approval: item };
		}
		const executionInput = this.executionInputs.get(id);
		if (executionInput === undefined) {
			return { ok: false, reason: "input_unavailable", approval: item };
		}
		const approved = this.approve(id, note, resolutionSource);
		if (!approved) return { ok: false, reason: "not_found" };
		return { ok: true, approval: approved };
	}

	reject(id: string, reason?: string, resolutionSource?: string): PendingApproval | null {
		const path = approvalFilePath(this.dir, id);
		if (!path) return null;
		const item = this.get(id);
		if (!item || item.status !== "pending" || !this.belongsToQueue(item)) return null;
		item.status = "rejected";
		item.resolvedAt = new Date().toISOString();
		item.rejectionReason = reason;
		if (resolutionSource) item.resolutionSource = resolutionSource;
		const stored = this.write(item);
		this.executionInputs.delete(id);
		emitApprovalResolved(this.pbus, stored, false, stored.rejectionReason ?? "", this.count("pending"));
		return stored;
	}

	expireStale(defaultTtlMs?: number): PendingApproval[] {
		const now = Date.now();
		const expired: PendingApproval[] = [];
		for (const item of this.list("pending")) {
			const ttl = item.timeoutMs ?? defaultTtlMs ?? DEFAULT_APPROVAL_PENDING_TTL_MS;
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
			const stored = this.write(item);
			this.executionInputs.delete(item.id);
			emitApprovalExpired(this.pbus, stored, resolution, this.count("pending"));
			expired.push(stored);
		}
		return expired;
	}

	approveAll(note?: string): PendingApproval[] {
		return this.list("pending").map((item) => this.approve(item.id, note)).filter(Boolean) as PendingApproval[];
	}

	approveAllForExecution(note?: string): ApprovalExecutionApproveAllResult {
		return this.approvePendingForExecution(
			this.list("pending").map((item) => item.id),
			note,
		);
	}

	approvePendingForExecution(
		approvalIds: readonly string[],
		note?: string,
	): ApprovalExecutionApproveAllResult {
		const pending = approvalIds
			.map((id) => this.get(id))
			.filter((item): item is PendingApproval => item?.status === "pending");
		const mismatched = pending.filter((item) => !this.belongsToQueue(item));
		if (mismatched.length > 0) {
			return { ok: false, reason: "scope_mismatch", approvals: mismatched };
		}
		const unavailable = pending.filter((item) => !this.executionInputs.has(item.id));
		if (unavailable.length > 0) {
			return { ok: false, reason: "input_unavailable", approvals: unavailable };
		}
		const approvals: PendingApproval[] = [];
		for (const item of pending) {
			const result = this.approveForExecution(item.id, note);
			if (!result.ok) {
				throw new Error(`Approval ${item.id} became unavailable during approve-all execution`);
			}
			approvals.push(result.approval);
		}
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
		if (!existsSync(this.dir)) return;
		for (const f of readdirSync(this.dir).filter((f) => f.endsWith(".json"))) {
			unlinkSync(join(this.dir, f));
		}
		this.executionInputs.clear();
	}
}

let _queue: ApprovalQueue | null = null;

export function getApprovalQueue(dir?: string): ApprovalQueue {
	if (!_queue) _queue = new ApprovalQueue(dir ?? join(process.cwd(), ".kota", "approvals"));
	return _queue;
}

// Project runtime bundle setup installs the default scope's queue instance here.
export function setApprovalQueueInstance(queue: ApprovalQueue): void {
	_queue = queue;
}

export function resetApprovalQueue(): void {
	_queue = null;
}
