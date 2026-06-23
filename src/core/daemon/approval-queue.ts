/**
 * ApprovalQueue — file-based queue for tool calls requiring human approval.
 *
 * When guardrails resolve to "queue" policy (default for dangerous operations
 * in non-interactive contexts), the tool call is stored here. Users review
 * and approve/reject via the approval agent tool. Approved items execute
 * immediately.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import {
	cloneEvidenceJsonObject,
	type EvidenceProjectionTarget,
	evidenceRetentionDurationMsFor,
	projectEvidenceJsonValueAsDataClass,
	projectEvidenceText,
	redactSensitiveText,
} from "#core/evidence/policy.js";
import type { RiskLevel } from "#core/tools/guardrails.js";

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
};

export type PendingApproval = {
	id: string;
	seq?: number;
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
			reason: "not_found" | "input_unavailable";
			approval?: PendingApproval;
	  };

export type ApprovalExecutionApproveAllResult =
	| {
			ok: true;
			approvals: PendingApproval[];
	  }
	| {
			ok: false;
			reason: "input_unavailable";
			approvals: PendingApproval[];
	  };

const APPROVAL_ID_PATTERN = /^[0-9a-f]{8}$/;
const DEFAULT_APPROVAL_PENDING_TTL_MS = evidenceRetentionDurationMsFor({
	artifactType: "approval",
	state: "pending",
	scope: "directory",
});

export function isApprovalId(id: string): boolean {
	return APPROVAL_ID_PATTERN.test(id);
}

export function defaultApprovalPendingTtlMs(): number {
	return DEFAULT_APPROVAL_PENDING_TTL_MS;
}

export function projectApprovalForClient(
	item: PendingApproval,
	target: EvidenceProjectionTarget = "daemon-api",
): ApprovalClientProjection {
	const projected: ApprovalClientProjection = {
		...projectApprovalTextFields(item),
		input: projectApprovalInputForTarget(item.input, target),
	};
	if (item.context !== undefined) {
		const context = projectEvidenceText(item.context, target, "tool-io");
		if (typeof context === "string") {
			projected.context = context;
		} else {
			projected.context = "[redacted]";
			projected.contextRedaction = {
				redacted: true,
				reason: "tool-io",
				...(context.bytes !== undefined ? { bytes: context.bytes } : {}),
			};
		}
	}
	return projected;
}

function approvalFilePath(dir: string, id: string): string | null {
	return isApprovalId(id) ? join(dir, `${id}.json`) : null;
}

function approvalFilePathForItem(dir: string, item: PendingApproval): string {
	const path = approvalFilePath(dir, item.id);
	if (!path) throw new Error(`Malformed approval id: ${item.id}`);
	return path;
}

function projectApprovalForStorage(item: PendingApproval): PendingApproval {
	const projected: PendingApproval = {
		...projectApprovalTextFields(item),
		input: projectApprovalInputForStorage(item.input),
	};
	if (item.context !== undefined) {
		delete projected.context;
		projected.contextRedaction = projectApprovalContextForStorage(item.context);
	}
	return projected;
}

function projectApprovalInputForStorage(input: PendingApproval["input"]): PendingApproval["input"] {
	if (isToolIoRedactionRecord(input)) return input;
	const projected = projectApprovalInputForTarget(input, "internal-storage");
	if (!isToolIoRedactionRecord(projected)) {
		throw new Error("Approval input storage projection must redact tool I/O");
	}
	return projected;
}

function projectApprovalTextFields(item: PendingApproval): PendingApproval {
	const projected: PendingApproval = {
		...item,
		reason: projectApprovalText(item.reason),
	};
	if (item.source !== undefined) projected.source = projectApprovalText(item.source);
	if (item.approvalNote !== undefined) {
		projected.approvalNote = projectApprovalText(item.approvalNote);
	}
	if (item.rejectionReason !== undefined) {
		projected.rejectionReason = projectApprovalText(item.rejectionReason);
	}
	if (item.resolutionSource !== undefined) {
		projected.resolutionSource = projectApprovalText(item.resolutionSource);
	}
	return projected;
}

function projectApprovalText(text: string): string {
	return redactSensitiveText(text);
}

function projectApprovalInputForTarget(
	input: PendingApproval["input"],
	target: EvidenceProjectionTarget,
): PendingApproval["input"] {
	const projected = projectEvidenceJsonValueAsDataClass(
		cloneEvidenceJsonObject(input),
		target,
		"tool-io",
	);
	if (typeof projected !== "object" || projected === null || Array.isArray(projected)) {
		throw new Error("Approval input projection must remain an object");
	}
	return projected;
}

function projectApprovalContextForStorage(context: string): ApprovalToolIoRedaction {
	const projected = projectEvidenceText(context, "internal-storage", "tool-io");
	if (typeof projected === "string" || projected.reason !== "tool-io") {
		throw new Error("Approval context storage projection must redact tool I/O");
	}
	return {
		redacted: true,
		reason: "tool-io",
		...(projected.bytes !== undefined ? { bytes: projected.bytes } : {}),
	};
}

function isToolIoRedactionRecord(
	value: PendingApproval["input"],
): value is ApprovalToolIoRedaction & PendingApproval["input"] {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		value.redacted === true &&
		value.reason === "tool-io"
	);
}

let _enqueueSeq = 0;

export class ApprovalQueue {
	private pbus: ProjectScopedEventBus | null;
	private executionInputs = new Map<string, PendingApproval["input"]>();

	constructor(private dir: string, pbus?: ProjectScopedEventBus | null) {
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		this.pbus = pbus ?? null;
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
		if (this.pbus) {
			this.pbus.emit("approval.requested", {
				id: stored.id,
				tool,
				risk,
				reason: stored.reason,
				source: stored.source ?? "",
				sessionId: sessionId ?? "",
			});
			this.pbus.emit("approval.changed", { id: item.id, pendingCount: this.count("pending") });
		}
		return stored;
	}

	get(id: string): PendingApproval | null {
		const path = approvalFilePath(this.dir, id);
		if (!path) return null;
		if (!existsSync(path)) return null;
		return projectApprovalForStorage(JSON.parse(readFileSync(path, "utf-8")) as PendingApproval);
	}

	list(status?: ApprovalStatus): PendingApproval[] {
		if (!existsSync(this.dir)) return [];
		return readdirSync(this.dir)
			.filter((f) => f.endsWith(".json"))
			.map((f) =>
				projectApprovalForStorage(JSON.parse(readFileSync(join(this.dir, f), "utf-8")) as PendingApproval)
			)
			.filter((item) => !status || item.status === status)
			.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.seq ?? 0) - (b.seq ?? 0));
	}

	approve(id: string, note?: string, resolutionSource?: string): PendingApproval | null {
		const path = approvalFilePath(this.dir, id);
		if (!path) return null;
		const item = this.get(id);
		if (!item || item.status !== "pending") return null;
		item.status = "approved";
		item.resolvedAt = new Date().toISOString();
		if (note) item.approvalNote = note;
		if (resolutionSource) item.resolutionSource = resolutionSource;
		const stored = this.write(item);
		const executionInput = this.executionInputs.get(id);
		this.executionInputs.delete(id);
		if (this.pbus) {
			this.pbus.emit("approval.resolved", {
				id,
				tool: stored.tool,
				approved: true,
				reason: "",
				source: stored.source ?? "",
				sessionId: stored.sessionId ?? "",
			});
			this.pbus.emit("approval.changed", { id, pendingCount: this.count("pending") });
		}
		return executionInput === undefined ? stored : { ...stored, input: executionInput };
	}

	approveForExecution(
		id: string,
		note?: string,
		resolutionSource?: string,
	): ApprovalExecutionApprovalResult {
		const item = this.get(id);
		if (!item || item.status !== "pending") return { ok: false, reason: "not_found" };
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
		if (!item || item.status !== "pending") return null;
		item.status = "rejected";
		item.resolvedAt = new Date().toISOString();
		item.rejectionReason = reason;
		if (resolutionSource) item.resolutionSource = resolutionSource;
		const stored = this.write(item);
		this.executionInputs.delete(id);
		if (this.pbus) {
			this.pbus.emit("approval.resolved", {
				id,
				tool: stored.tool,
				approved: false,
				reason: stored.rejectionReason ?? "",
				source: stored.source ?? "",
				sessionId: stored.sessionId ?? "",
			});
			this.pbus.emit("approval.changed", { id, pendingCount: this.count("pending") });
		}
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
			if (this.pbus) {
				this.pbus.emit("workflow.approval.timeout", { id: stored.id, tool: stored.tool, defaultResolution: resolution });
				this.pbus.emit("approval.expired", { id: stored.id, tool: stored.tool });
				this.pbus.emit("approval.resolved", {
					id: stored.id,
					tool: stored.tool,
					approved: resolution === "approve",
					reason: stored.rejectionReason ?? "",
					source: stored.source ?? "",
					sessionId: stored.sessionId ?? "",
				});
				this.pbus.emit("approval.changed", { id: stored.id, pendingCount: this.count("pending") });
			}
			expired.push(stored);
		}
		return expired;
	}

	approveAll(note?: string): PendingApproval[] {
		return this.list("pending").map((item) => this.approve(item.id, note)).filter(Boolean) as PendingApproval[];
	}

	approveAllForExecution(note?: string): ApprovalExecutionApproveAllResult {
		const pending = this.list("pending");
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

// ─── Singleton ───────────────────────────────────────────────────────

let _queue: ApprovalQueue | null = null;

export function getApprovalQueue(dir?: string): ApprovalQueue {
	if (!_queue) _queue = new ApprovalQueue(dir ?? join(process.cwd(), ".kota", "approvals"));
	return _queue;
}

/**
 * Install a pre-built {@link ApprovalQueue} as the module-level singleton.
 * Used by the per-project runtime bundle factory to register the default
 * project's instance without re-binding the queue directory outside the
 * bundle.
 */
export function setApprovalQueueInstance(queue: ApprovalQueue): void {
	_queue = queue;
}

export function resetApprovalQueue(): void {
	_queue = null;
}
