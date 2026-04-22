import type { Command } from "commander";
import type { AuditEntry, AuditFilter } from "#core/tools/audit-store.js";
import { AuditStore } from "#core/tools/audit-store.js";
import {
	type LineNode,
	line,
	plain,
	span,
	stack,
} from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";

const DEFAULT_LIMIT = 50;

function formatTimestamp(ts: string): string {
	return ts.slice(0, 19).replace("T", " ");
}

function pad(s: string, width: number): string {
	return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function riskRole(risk: string): "error" | "warn" | "info" | "muted" | "success" {
	switch (risk) {
		case "critical":
		case "dangerous":
			return "error";
		case "moderate":
			return "warn";
		case "low":
			return "info";
		case "safe":
			return "success";
		default:
			return "muted";
	}
}

function policyRole(policy: string): "success" | "warn" | "error" | "muted" {
	switch (policy) {
		case "allow":
			return "success";
		case "confirm":
			return "warn";
		case "deny":
			return "error";
		default:
			return "muted";
	}
}

export function buildAuditListLines(entries: AuditEntry[]): LineNode[] {
	const sessionWidth = Math.max(...entries.map((e) => (e.session ?? "-").length), 7);
	const toolWidth = Math.max(...entries.map((e) => e.tool.length), 4);
	const riskWidth = Math.max(...entries.map((e) => e.risk.length), 4);
	const policyWidth = Math.max(...entries.map((e) => e.policy.length), 6);
	const tsWidth = 19;

	const headerLabel = [
		pad("SESSION", sessionWidth),
		pad("TOOL", toolWidth),
		pad("RISK", riskWidth),
		pad("POLICY", policyWidth),
		"TIMESTAMP",
	].join("  ");
	const header = line(span(headerLabel, "muted", true));
	const rule = line(span("-".repeat(headerLabel.length), "muted"));

	const rows: LineNode[] = entries.map((e) => line(
		span(pad(e.session ?? "-", sessionWidth), "muted"),
		plain("  "),
		plain(pad(e.tool, toolWidth)),
		plain("  "),
		span(pad(e.risk, riskWidth), riskRole(e.risk)),
		plain("  "),
		span(pad(e.policy, policyWidth), policyRole(e.policy)),
		plain("  "),
		span(pad(formatTimestamp(e.ts), tsWidth), "muted"),
	));

	return [header, rule, ...rows];
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
				if (entries.length === 0) {
					print(line(plain("No audit entries.")));
					return;
				}
				print(stack(...buildAuditListLines(entries)));
			} catch (err) {
				console.error(`Error reading audit store: ${(err as Error).message}`);
				process.exit(1);
			}
		});
}
