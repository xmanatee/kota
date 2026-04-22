import { createInterface } from "node:readline";
import type { Command } from "commander";
import { loadConfig } from "#core/config/config.js";
import type { ApprovalStatus, PendingApproval } from "#core/daemon/approval-queue.js";
import { getApprovalQueue } from "#core/daemon/approval-queue.js";
import { executeTool } from "#core/tools/index.js";
import {
	blank,
	type LineNode,
	line,
	plain,
	type RenderNode,
	span,
	stack,
} from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function formatAge(createdAt: string): string {
	const ageMs = Date.now() - new Date(createdAt).getTime();
	const minutes = Math.floor(ageMs / 60_000);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(ageMs / 3_600_000);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(ageMs / 86_400_000);
	return `${days}d ago`;
}

async function promptConfirm(message: string): Promise<boolean> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(message, (answer) => {
			rl.close();
			resolve(answer.toLowerCase().startsWith("y"));
		});
	});
}

function parseDuration(s: string): number | null {
	const m = /^(\d+)(h|m|d)$/.exec(s);
	if (!m) return null;
	const n = parseInt(m[1], 10);
	if (m[2] === "h") return n * 3_600_000;
	if (m[2] === "m") return n * 60_000;
	return n * 86_400_000;
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

function statusRole(status: ApprovalStatus): "success" | "error" | "muted" | "warn" | "accent" {
	switch (status) {
		case "approved":
			return "success";
		case "rejected":
			return "error";
		case "expired":
			return "warn";
		case "pending":
			return "accent";
	}
}

function renderPendingItem(item: PendingApproval, opts?: { includeWhy?: boolean }): RenderNode {
	const inputSummary = JSON.stringify(item.input).slice(0, 80);
	const rows: LineNode[] = [
		line(
			span(`  [${item.id}]`, "accent", true),
			plain(" "),
			plain(item.tool),
			plain("  "),
			span(`(${formatAge(item.createdAt)})`, "muted"),
		),
		line(span("    Input:  ", "muted"), plain(inputSummary)),
		line(span("    Risk:   ", "muted"), span(item.risk, riskRole(item.risk))),
		line(span("    Reason: ", "muted"), plain(item.reason)),
	];
	if (item.source) rows.push(line(span("    Source: ", "muted"), plain(item.source)));
	if (opts?.includeWhy && item.context) {
		const lastLine = item.context.split("\n").filter(Boolean).at(-1) ?? "";
		rows.push(line(span("    Why:    ", "muted"), plain(lastLine.slice(0, 120))));
	}
	return stack(...rows, blank());
}

function renderResolvedItem(item: PendingApproval): RenderNode {
	const resolvedAgo = item.resolvedAt ? formatAge(item.resolvedAt) : "—";
	const rows: LineNode[] = [
		line(
			span(`  [${item.id}]`, "accent", true),
			plain(` ${item.tool}  status=`),
			span(item.status, statusRole(item.status)),
			plain(`  resolved=${resolvedAgo}`),
		),
		line(span("    Risk:   ", "muted"), span(item.risk, riskRole(item.risk))),
	];
	if (item.rejectionReason && item.rejectionReason !== "expired") {
		rows.push(line(span("    Reason: ", "muted"), plain(item.rejectionReason)));
	}
	if (item.approvalNote) rows.push(line(span("    Note:   ", "muted"), plain(item.approvalNote)));
	if (item.source) rows.push(line(span("    Source: ", "muted"), plain(item.source)));
	return stack(...rows, blank());
}

export function registerApprovalCommands(program: Command): void {
	const approvalCmd = program
		.command("approval")
		.description("Manage the tool-call approval queue");

	approvalCmd
		.command("list")
		.description("List all pending approval items")
		.action(() => {
			const config = loadConfig();
			const ttlMs = config.approvalTtlMs ?? DEFAULT_TTL_MS;
			const queue = getApprovalQueue();
			queue.expireStale(ttlMs);
			const items = queue.list("pending");
			if (items.length === 0) {
				print(line(plain("No pending approvals.")));
				return;
			}
			print(stack(
				line(
					span(String(items.length), "accent", true),
					plain(" pending approval(s):"),
				),
				blank(),
				...items.map((item) => renderPendingItem(item, { includeWhy: true })),
			));
		});

	approvalCmd
		.command("approve <id>")
		.description("Approve and execute a queued tool call")
		.option("-n, --note <text>", "Note to attach with the approval")
		.action(async (id: string, opts: { note?: string }) => {
			const queue = getApprovalQueue();
			const item = queue.approve(id, opts.note);
			if (!item) {
				console.error(`Error: approval "${id}" not found or already resolved.`);
				process.exit(1);
			}
			const result = await executeTool(item.tool, item.input);
			if (result.is_error) {
				console.error(`Tool execution failed:\n${result.content}`);
				process.exit(1);
			}
			const noteSuffix = item.approvalNote ? ` — note: ${item.approvalNote}` : "";
			print(stack(
				line(
					span("Approved and executed ", "success"),
					plain(`${item.tool}:`),
				),
				line(plain(`${result.content}${noteSuffix}`)),
			));
		});

	approvalCmd
		.command("approve-all")
		.description("Approve and execute all pending tool calls")
		.option("-y, --yes", "Skip confirmation prompt")
		.option("-n, --note <text>", "Note to attach to every approved item")
		.option("--risk <level>", "Only approve items of this risk level")
		.action(async (opts: { yes?: boolean; note?: string; risk?: string }) => {
			const config = loadConfig();
			const ttlMs = config.approvalTtlMs ?? DEFAULT_TTL_MS;
			const queue = getApprovalQueue();
			queue.expireStale(ttlMs);
			let items = queue.list("pending");
			if (opts.risk) {
				items = items.filter((item) => item.risk === opts.risk);
			}

			if (items.length === 0) {
				const qualifier = opts.risk ? ` with risk level "${opts.risk}"` : "";
				print(line(plain(`No pending approvals${qualifier}.`)));
				return;
			}

			print(stack(
				line(
					span(String(items.length), "accent", true),
					plain(" pending approval(s) to be approved:"),
				),
				blank(),
				...items.map((item) => renderPendingItem(item)),
			));

			if (!opts.yes) {
				const confirmed = await promptConfirm(`Approve all ${items.length} item(s)? [y/N] `);
				if (!confirmed) {
					print(line(span("Aborted.", "muted")));
					return;
				}
			}

			let succeeded = 0;
			let failed = 0;

			for (const item of items) {
				const approved = queue.approve(item.id, opts.note);
				if (!approved) {
					print(line(
						span("  Skipped ", "muted"),
						span(`[${item.id}]`, "accent"),
						plain(` ${item.tool} — no longer pending.`),
					));
					continue;
				}
				const result = await executeTool(item.tool, item.input);
				if (result.is_error) {
					console.error(`  Failed [${item.id}] ${item.tool}: ${result.content}`);
					failed++;
				} else {
					const noteSuffix = approved.approvalNote ? ` — note: ${approved.approvalNote}` : "";
					print(line(
						span("  Approved and executed ", "success"),
						plain(`${item.tool} `),
						span(`[${item.id}]`, "accent"),
						plain(noteSuffix),
					));
					succeeded++;
				}
			}

			print(stack(
				blank(),
				line(
					plain("Done: "),
					span(`${succeeded} approved`, succeeded > 0 ? "success" : "muted"),
					plain(", "),
					span(`${failed} failed`, failed > 0 ? "error" : "muted"),
					plain("."),
				),
			));
			if (failed > 0) process.exit(1);
		});

	approvalCmd
		.command("reject <id>")
		.description("Reject a queued tool call")
		.option("-r, --reason <text>", "Reason for rejection")
		.action((id: string, opts: { reason?: string }) => {
			const queue = getApprovalQueue();
			const item = queue.reject(id, opts.reason);
			if (!item) {
				console.error(`Error: approval "${id}" not found or already resolved.`);
				process.exit(1);
			}
			const suffix = opts.reason ? ` — ${opts.reason}` : "";
			print(line(
				span("Rejected: ", "error"),
				plain(`${item.tool} `),
				span(`[${id}]`, "accent"),
				plain(suffix),
			));
		});

	approvalCmd
		.command("reject-all")
		.description("Reject all pending tool calls")
		.option("-y, --yes", "Skip confirmation prompt")
		.option("-r, --reason <text>", "Reason to attach to every rejected item")
		.option("--risk <level>", "Only reject items of this risk level")
		.action(async (opts: { yes?: boolean; reason?: string; risk?: string }) => {
			const config = loadConfig();
			const ttlMs = config.approvalTtlMs ?? DEFAULT_TTL_MS;
			const queue = getApprovalQueue();
			queue.expireStale(ttlMs);
			let items = queue.list("pending");
			if (opts.risk) {
				items = items.filter((item) => item.risk === opts.risk);
			}

			if (items.length === 0) {
				const qualifier = opts.risk ? ` with risk level "${opts.risk}"` : "";
				print(line(plain(`No pending approvals${qualifier}.`)));
				return;
			}

			print(stack(
				line(
					span(String(items.length), "accent", true),
					plain(" pending approval(s) to be rejected:"),
				),
				blank(),
				...items.map((item) => renderPendingItem(item)),
			));

			if (!opts.yes) {
				const confirmed = await promptConfirm(`Reject all ${items.length} item(s)? [y/N] `);
				if (!confirmed) {
					print(line(span("Aborted.", "muted")));
					return;
				}
			}

			let rejected = 0;

			for (const item of items) {
				const result = queue.reject(item.id, opts.reason);
				if (!result) {
					print(line(
						span("  Skipped ", "muted"),
						span(`[${item.id}]`, "accent"),
						plain(` ${item.tool} — no longer pending.`),
					));
					continue;
				}
				const reasonSuffix = opts.reason ? ` — ${opts.reason}` : "";
				print(line(
					span("  Rejected ", "error"),
					plain(`${item.tool} `),
					span(`[${item.id}]`, "accent"),
					plain(reasonSuffix),
				));
				rejected++;
			}

			print(stack(
				blank(),
				line(
					plain("Done: "),
					span(`${rejected} rejected`, rejected > 0 ? "success" : "muted"),
					plain("."),
				),
			));
		});

	approvalCmd
		.command("count")
		.description("Print the number of pending approval items")
		.action(() => {
			const queue = getApprovalQueue();
			console.log(String(queue.count("pending")));
		});

	approvalCmd
		.command("history")
		.description("List resolved and expired approvals")
		.option("--status <status>", "Filter by status: approved, rejected, expired")
		.option("-n <count>", "Max results to show (default 20)", "20")
		.option("--since <duration>", "Only show items resolved within this window (e.g. 1h, 24h, 7d)")
		.action((opts: { status?: string; n: string; since?: string }) => {
			const queue = getApprovalQueue();
			const limit = Math.max(1, parseInt(opts.n, 10) || 20);

			const statusFilter = opts.status as ApprovalStatus | undefined;
			const validStatuses: ApprovalStatus[] = ["approved", "rejected", "expired"];
			if (statusFilter && !validStatuses.includes(statusFilter)) {
				console.error(`Error: invalid --status "${statusFilter}". Must be one of: ${validStatuses.join(", ")}`);
				process.exit(1);
			}

			let sinceMs: number | null = null;
			if (opts.since) {
				sinceMs = parseDuration(opts.since);
				if (sinceMs === null) {
					console.error(`Error: invalid --since "${opts.since}". Use format like 1h, 24h, 7d.`);
					process.exit(1);
				}
			}

			const cutoff = sinceMs !== null ? Date.now() - sinceMs : null;

			const items = queue
				.list()
				.filter((item) => item.status !== "pending")
				.filter((item) => !statusFilter || item.status === statusFilter)
				.filter((item) => {
					if (cutoff === null) return true;
					const ts = item.resolvedAt ?? item.createdAt;
					return new Date(ts).getTime() >= cutoff;
				})
				.sort((a, b) => {
					const ta = a.resolvedAt ?? a.createdAt;
					const tb = b.resolvedAt ?? b.createdAt;
					return tb.localeCompare(ta);
				})
				.slice(0, limit);

			if (items.length === 0) {
				print(line(plain("No resolved approvals found.")));
				return;
			}

			print(stack(
				line(
					span(String(items.length), "accent", true),
					plain(" resolved approval(s):"),
				),
				blank(),
				...items.map(renderResolvedItem),
			));
		});
}
