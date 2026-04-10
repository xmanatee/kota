import type { Command } from "commander";
import type { AuditEntry, AuditFilter } from "#core/tools/audit-store.js";
import { AuditStore } from "#core/tools/audit-store.js";

const DEFAULT_LIMIT = 50;

function formatTimestamp(ts: string): string {
	return ts.slice(0, 19).replace("T", " ");
}

function pad(s: string, width: number): string {
	return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function printTable(entries: AuditEntry[]): void {
	if (entries.length === 0) {
		console.log("No audit entries.");
		return;
	}

	const sessionWidth = Math.max(...entries.map((e) => (e.session ?? "-").length), 7);
	const toolWidth = Math.max(...entries.map((e) => e.tool.length), 4);
	const riskWidth = Math.max(...entries.map((e) => e.risk.length), 4);
	const policyWidth = Math.max(...entries.map((e) => e.policy.length), 6);
	const tsWidth = 19;

	const header = [
		pad("SESSION", sessionWidth),
		pad("TOOL", toolWidth),
		pad("RISK", riskWidth),
		pad("POLICY", policyWidth),
		"TIMESTAMP",
	].join("  ");

	console.log(header);
	console.log("-".repeat(header.length));

	for (const e of entries) {
		const row = [
			pad(e.session ?? "-", sessionWidth),
			pad(e.tool, toolWidth),
			pad(e.risk, riskWidth),
			pad(e.policy, policyWidth),
			pad(formatTimestamp(e.ts), tsWidth),
		].join("  ");
		console.log(row);
	}
}

export function registerAuditCommands(program: Command): void {
	const auditCmd = program
		.command("audit")
		.description("Query the guardrail audit trail");

	auditCmd
		.command("list")
		.description("List recent audit entries")
		.option("--risk <level>", "Filter by risk level (safe, low, moderate, dangerous, critical)")
		.option("--policy <outcome>", "Filter by policy outcome (allow, confirm, deny)")
		.option("-n, --limit <n>", "Maximum entries to show", String(DEFAULT_LIMIT))
		.action((opts: { risk?: string; policy?: string; limit: string }) => {
			const limit = Math.max(1, parseInt(opts.limit, 10) || DEFAULT_LIMIT);
			const filter: AuditFilter = { limit };
			if (opts.risk) filter.risk = opts.risk as AuditFilter["risk"];
			if (opts.policy) filter.policy = opts.policy as AuditFilter["policy"];

			try {
				const store = new AuditStore(process.cwd());
				const entries = store.query(filter);
				printTable(entries);
			} catch (err) {
				console.error(`Error reading audit store: ${(err as Error).message}`);
				process.exit(1);
			}
		});
}
