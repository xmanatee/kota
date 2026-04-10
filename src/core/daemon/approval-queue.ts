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
import { tryEmit } from "../events/event-bus.js";
import type { RiskLevel } from "../tools/guardrails.js";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export type PendingApproval = {
	id: string;
	seq?: number;
	tool: string;
	input: Record<string, unknown>;
	risk: RiskLevel;
	reason: string;
	source?: string;
	/** Last N agent conversation turns captured at enqueue time, for operator context. */
	context?: string;
	createdAt: string;
	status: ApprovalStatus;
	resolvedAt?: string;
	rejectionReason?: string;
	approvalNote?: string;
	timeoutMs?: number;
	defaultResolution?: "deny" | "approve";
	resolutionSource?: string;
};

let _enqueueSeq = 0;

export class ApprovalQueue {
	constructor(private dir: string) {
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
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
	): PendingApproval {
		const item: PendingApproval = {
			id: randomUUID().slice(0, 8),
			seq: _enqueueSeq++,
			tool,
			input,
			risk,
			reason,
			source,
			...(context !== undefined && { context }),
			createdAt: new Date().toISOString(),
			status: "pending",
			...(timeoutMs !== undefined && { timeoutMs }),
			...(defaultResolution !== undefined && { defaultResolution }),
		};
		writeFileSync(join(this.dir, `${item.id}.json`), JSON.stringify(item, null, 2));
		tryEmit("approval.requested", { id: item.id, tool, risk, reason, source: source ?? "" });
		tryEmit("approval.changed", { id: item.id, pendingCount: this.count("pending") });
		return item;
	}

	get(id: string): PendingApproval | null {
		const path = join(this.dir, `${id}.json`);
		if (!existsSync(path)) return null;
		return JSON.parse(readFileSync(path, "utf-8"));
	}

	list(status?: ApprovalStatus): PendingApproval[] {
		if (!existsSync(this.dir)) return [];
		return readdirSync(this.dir)
			.filter((f) => f.endsWith(".json"))
			.map((f) => JSON.parse(readFileSync(join(this.dir, f), "utf-8")) as PendingApproval)
			.filter((item) => !status || item.status === status)
			.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.seq ?? 0) - (b.seq ?? 0));
	}

	approve(id: string, note?: string, resolutionSource?: string): PendingApproval | null {
		const item = this.get(id);
		if (!item || item.status !== "pending") return null;
		item.status = "approved";
		item.resolvedAt = new Date().toISOString();
		if (note) item.approvalNote = note;
		if (resolutionSource) item.resolutionSource = resolutionSource;
		writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(item, null, 2));
		tryEmit("approval.resolved", { id, tool: item.tool, approved: true, reason: "" });
		tryEmit("approval.changed", { id, pendingCount: this.count("pending") });
		return item;
	}

	reject(id: string, reason?: string, resolutionSource?: string): PendingApproval | null {
		const item = this.get(id);
		if (!item || item.status !== "pending") return null;
		item.status = "rejected";
		item.resolvedAt = new Date().toISOString();
		item.rejectionReason = reason;
		if (resolutionSource) item.resolutionSource = resolutionSource;
		writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(item, null, 2));
		tryEmit("approval.resolved", { id, tool: item.tool, approved: false, reason: reason ?? "" });
		tryEmit("approval.changed", { id, pendingCount: this.count("pending") });
		return item;
	}

	expireStale(defaultTtlMs?: number): PendingApproval[] {
		const now = Date.now();
		const expired: PendingApproval[] = [];
		for (const item of this.list("pending")) {
			const ttl = item.timeoutMs ?? defaultTtlMs;
			if (!ttl) continue;
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
			writeFileSync(join(this.dir, `${item.id}.json`), JSON.stringify(item, null, 2));
			tryEmit("workflow.approval.timeout", { id: item.id, tool: item.tool, defaultResolution: resolution });
			tryEmit("approval.expired", { id: item.id, tool: item.tool });
			tryEmit("approval.resolved", { id: item.id, tool: item.tool, approved: resolution === "approve", reason: "expired" });
			tryEmit("approval.changed", { id: item.id, pendingCount: this.count("pending") });
			expired.push(item);
		}
		return expired;
	}

	approveAll(note?: string): PendingApproval[] {
		return this.list("pending").map((item) => this.approve(item.id, note)).filter(Boolean) as PendingApproval[];
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
	}
}

// ─── Singleton ───────────────────────────────────────────────────────

let _queue: ApprovalQueue | null = null;

export function getApprovalQueue(dir?: string): ApprovalQueue {
	if (!_queue) _queue = new ApprovalQueue(dir ?? join(process.cwd(), ".kota", "approvals"));
	return _queue;
}

export function resetApprovalQueue(): void {
	_queue = null;
}
