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
import { tryEmit } from "./event-bus.js";
import type { RiskLevel } from "./guardrails.js";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export type PendingApproval = {
	id: string;
	tool: string;
	input: Record<string, unknown>;
	risk: RiskLevel;
	reason: string;
	source?: string;
	createdAt: string;
	status: ApprovalStatus;
	resolvedAt?: string;
	rejectionReason?: string;
};

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
	): PendingApproval {
		const item: PendingApproval = {
			id: randomUUID().slice(0, 8),
			tool,
			input,
			risk,
			reason,
			source,
			createdAt: new Date().toISOString(),
			status: "pending",
		};
		writeFileSync(join(this.dir, `${item.id}.json`), JSON.stringify(item, null, 2));
		tryEmit("approval.requested", { id: item.id, tool, risk, reason, source: source ?? "" });
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
			.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	}

	approve(id: string): PendingApproval | null {
		const item = this.get(id);
		if (!item || item.status !== "pending") return null;
		item.status = "approved";
		item.resolvedAt = new Date().toISOString();
		writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(item, null, 2));
		tryEmit("approval.resolved", { id, tool: item.tool, approved: true, reason: "" });
		return item;
	}

	reject(id: string, reason?: string): PendingApproval | null {
		const item = this.get(id);
		if (!item || item.status !== "pending") return null;
		item.status = "rejected";
		item.resolvedAt = new Date().toISOString();
		item.rejectionReason = reason;
		writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(item, null, 2));
		tryEmit("approval.resolved", { id, tool: item.tool, approved: false, reason: reason ?? "" });
		return item;
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
