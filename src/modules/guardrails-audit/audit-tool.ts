/**
 * Audit tool — query the guardrail assessment audit trail.
 *
 * Lets the agent review past guardrail decisions: what was allowed, confirmed,
 * or denied, and why. Read-only, always available in the management group.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { getAuditStore } from "#core/tools/audit-store.js";
import type { ToolResult } from "#core/tools/index.js";

export const auditTool: Anthropic.Tool = {
	name: "audit",
	description:
		"Query the guardrail audit trail — review past tool-call risk assessments " +
		"(allowed, confirmed, denied). Filter by tool name, risk level, policy, " +
		"time range, or session. Use mode 'summary' for aggregate stats.",
	input_schema: {
		type: "object" as const,
		properties: {
			mode: {
				type: "string",
				enum: ["query", "summary"],
				description: "query: list individual entries. summary: aggregate stats. Default: query.",
			},
			tool: {
				type: "string",
				description: "Filter by tool name (exact match).",
			},
			risk: {
				type: "string",
				enum: ["safe", "moderate", "dangerous"],
				description: "Filter by risk level.",
			},
			policy: {
				type: "string",
				enum: ["allow", "confirm", "deny"],
				description: "Filter by policy decision.",
			},
			since: {
				type: "string",
				description: "ISO date string — only entries after this time.",
			},
			session: {
				type: "string",
				description: "Filter by session ID.",
			},
			limit: {
				type: "number",
				description: "Max entries to return (default: 50). Most recent first.",
			},
		},
		required: [],
	},
};

export async function runAudit(input: Record<string, unknown>): Promise<ToolResult> {
	const store = getAuditStore();
	if (!store) {
		return { content: "Audit store not initialized.", is_error: true };
	}

	const filter = {
		tool: input.tool as string | undefined,
		risk: input.risk as "safe" | "moderate" | "dangerous" | undefined,
		policy: input.policy as "allow" | "confirm" | "deny" | undefined,
		since: input.since as string | undefined,
		session: input.session as string | undefined,
		limit: (input.limit as number) ?? 50,
	};

	const mode = (input.mode as string) || "query";

	if (mode === "summary") {
		const summary = store.summarize(filter);
		if (summary.total === 0) return { content: "No audit entries match the filter." };

		const lines = [`## Audit Summary (${summary.total} entries)`];

		const riskLine = Object.entries(summary.byRisk)
			.map(([k, v]) => `${k}: ${v}`)
			.join(", ");
		if (riskLine) lines.push(`Risk: ${riskLine}`);

		const policyLine = Object.entries(summary.byPolicy)
			.map(([k, v]) => `${k}: ${v}`)
			.join(", ");
		if (policyLine) lines.push(`Policy: ${policyLine}`);

		const toolEntries = Object.entries(summary.byTool).sort((a, b) => b[1] - a[1]);
		if (toolEntries.length > 0) {
			lines.push(`\nTop tools:`);
			for (const [name, count] of toolEntries.slice(0, 15)) {
				lines.push(`  ${name}: ${count}`);
			}
		}

		return { content: lines.join("\n") };
	}

	const entries = store.query(filter);
	if (entries.length === 0) return { content: "No audit entries match the filter." };

	const lines = [`${entries.length} entries (most recent first):\n`];
	for (const e of entries) {
		const ts = e.ts.replace("T", " ").replace(/\.\d{3}Z$/, "Z");
		lines.push(`[${ts}] ${e.tool} — ${e.risk}/${e.policy}: ${e.reason}`);
	}

	return { content: lines.join("\n") };
}

