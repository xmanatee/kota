import type { Command } from "commander";
import type { ApprovalStatus } from "#core/daemon/approval-queue.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { blank, line, plain, span, stack } from "#modules/rendering/primitives.js";
import { print, writeStdoutLine } from "#modules/rendering/transport.js";
import {
	parseDuration,
	printApprovalError,
	renderPendingItem,
	renderResolvedItem,
} from "./cli-support.js";

export function registerApprovalReadCommands(command: Command, ctx: ModuleContext): void {
	command
		.command("list")
		.description("List all pending approval items")
		.action(async () => {
			const result = await ctx.client.approvals.list();
			const items = result.approvals.filter((item) => item.status === "pending");
			if (items.length === 0) {
				print(line(plain("No pending approvals.")));
				return;
			}
			print(stack(
				line(span(String(items.length), "accent", true), plain(" pending approval(s):")),
				blank(),
				...items.map(renderPendingItem),
			));
		});

	command
		.command("count")
		.description("Print the number of pending approval items")
		.action(async () => {
			const result = await ctx.client.approvals.list({ status: "pending" });
			writeStdoutLine(String(result.approvals.length));
		});

	command
		.command("history")
		.description("List resolved and expired approvals")
		.option("--status <status>", "Filter by status: approved, rejected, expired")
		.option("-n <count>", "Max results to show (default 20)", "20")
		.option("--since <duration>", "Only show items resolved within this window (e.g. 1h, 24h, 7d)")
		.action(async (opts: { status?: string; n: string; since?: string }) => {
			const limit = Math.max(1, parseInt(opts.n, 10) || 20);
			const status = opts.status as ApprovalStatus | undefined;
			const validStatuses: ApprovalStatus[] = ["approved", "rejected", "expired"];
			if (status && !validStatuses.includes(status)) {
				printApprovalError(
					`Error: invalid --status "${status}". Must be one of: ${validStatuses.join(", ")}`,
				);
				process.exit(1);
			}
			const sinceMs = opts.since ? parseDuration(opts.since) : null;
			if (opts.since && sinceMs === null) {
				printApprovalError(`Error: invalid --since "${opts.since}". Use format like 1h, 24h, 7d.`);
				process.exit(1);
			}
			const cutoff = sinceMs !== null ? Date.now() - sinceMs : null;
			const all = await ctx.client.approvals.list({ status: "all" });
			const items = all.approvals
				.filter((item) => item.status !== "pending")
				.filter((item) => !status || item.status === status)
				.filter((item) => {
					if (cutoff === null) return true;
					return new Date(item.resolvedAt ?? item.createdAt).getTime() >= cutoff;
				})
				.sort((a, b) => (b.resolvedAt ?? b.createdAt).localeCompare(a.resolvedAt ?? a.createdAt))
				.slice(0, limit);
			if (items.length === 0) {
				print(line(plain("No resolved approvals found.")));
				return;
			}
			print(stack(
				line(span(String(items.length), "accent", true), plain(" resolved approval(s):")),
				blank(),
				...items.map(renderResolvedItem),
			));
		});
}
