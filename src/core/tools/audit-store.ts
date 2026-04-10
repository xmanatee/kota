/**
 * Guardrails-audit store — persistent JSONL log of all guardrail assessments.
 *
 * Every tool call assessment is appended to `.kota/audit.jsonl`.
 * Provides query/filter/summarize for post-hoc analysis.
 *
 * Owned by the guardrails-audit module. Core code emits events to the bus;
 * the module subscribes and delegates to this store.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Assessment, Policy, RiskLevel } from "./guardrails.js";

export type AuditEntry = {
	ts: string;
	tool: string;
	risk: RiskLevel;
	policy: Policy;
	reason: string;
	session?: string;
};

export type AuditFilter = {
	tool?: string;
	risk?: RiskLevel;
	policy?: Policy;
	since?: string;
	session?: string;
	limit?: number;
};

export type AuditSummary = {
	total: number;
	byTool: Record<string, number>;
	byRisk: Record<string, number>;
	byPolicy: Record<string, number>;
};

const MAX_ENTRIES = 10_000;

export class AuditStore {
	private filePath: string;

	constructor(dir: string) {
		this.filePath = join(dir, ".kota", "audit.jsonl");
	}

	record(assessment: Assessment, session?: string): void {
		const entry: AuditEntry = {
			ts: new Date().toISOString(),
			tool: assessment.tool,
			risk: assessment.risk,
			policy: assessment.policy,
			reason: assessment.reason,
			...(session && { session }),
		};
		const parent = join(this.filePath, "..");
		if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
		appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`);
	}

	query(filter?: AuditFilter): AuditEntry[] {
		if (!existsSync(this.filePath)) return [];
		const lines = readFileSync(this.filePath, "utf-8").split("\n").filter(Boolean);
		let entries: AuditEntry[] = [];
		for (const line of lines) {
			try {
				entries.push(JSON.parse(line) as AuditEntry);
			} catch {
				// Skip malformed lines
			}
		}

		if (filter?.tool) entries = entries.filter((e) => e.tool === filter.tool);
		if (filter?.risk) entries = entries.filter((e) => e.risk === filter.risk);
		if (filter?.policy) entries = entries.filter((e) => e.policy === filter.policy);
		if (filter?.since) {
			const since = new Date(filter.since).toISOString();
			entries = entries.filter((e) => e.ts >= since);
		}
		if (filter?.session) entries = entries.filter((e) => e.session === filter.session);

		entries.reverse();
		if (filter?.limit && filter.limit > 0) entries = entries.slice(0, filter.limit);
		return entries;
	}

	summarize(filter?: AuditFilter): AuditSummary {
		const entries = this.query(filter);
		const byTool = new Map<string, number>();
		const byRisk = new Map<string, number>();
		const byPolicy = new Map<string, number>();

		for (const e of entries) {
			byTool.set(e.tool, (byTool.get(e.tool) ?? 0) + 1);
			byRisk.set(e.risk, (byRisk.get(e.risk) ?? 0) + 1);
			byPolicy.set(e.policy, (byPolicy.get(e.policy) ?? 0) + 1);
		}

		return {
			total: entries.length,
			byTool: Object.fromEntries(byTool),
			byRisk: Object.fromEntries(byRisk),
			byPolicy: Object.fromEntries(byPolicy),
		};
	}

	trim(max = MAX_ENTRIES): number {
		if (!existsSync(this.filePath)) return 0;
		const lines = readFileSync(this.filePath, "utf-8").split("\n").filter(Boolean);
		if (lines.length <= max) return 0;
		const trimmed = lines.length - max;
		writeFileSync(this.filePath, `${lines.slice(trimmed).join("\n")}\n`);
		return trimmed;
	}

	clear(): void {
		if (existsSync(this.filePath)) writeFileSync(this.filePath, "");
	}

	getPath(): string {
		return this.filePath;
	}
}

// Session-scoped singleton — set by the guardrails-audit module on load.
let _auditStore: AuditStore | null = null;

export function getAuditStore(): AuditStore | null {
	return _auditStore;
}

export function initAuditStore(projectDir: string): AuditStore {
	_auditStore = new AuditStore(projectDir);
	return _auditStore;
}

export function resetAuditStore(): void {
	_auditStore = null;
}
