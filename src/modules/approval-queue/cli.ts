import { createInterface } from "node:readline";
import type { Command } from "commander";
import { type ApprovalStatus, isApprovalId, type PendingApproval } from "#core/daemon/approval-queue.js";
import type { ModuleContext } from "#core/modules/module-types.js";
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
import { print, printToStderr, writeStdoutLine } from "#modules/rendering/transport.js";
import type { ApprovalExecutionProjection } from "./client.js";

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

const TERMINAL_ESCAPE_SEQUENCE_PATTERN =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: approval queue text can contain raw terminal controls
	/(?:\x1b\][\s\S]*?(?:\x07|\x1b\\|\x9c))|(?:\x9d[\s\S]*?(?:\x07|\x1b\\|\x9c))|(?:\x1b\[[0-?]*[ -/]*[@-~])|(?:\x9b[0-?]*[ -/]*[@-~])|(?:\x1b[@-_])/g;

const UNICODE_BIDI_FORMAT_CONTROL_PATTERN = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function stripApprovalTextControls(value: string): string {
	return value
		.replace(TERMINAL_ESCAPE_SEQUENCE_PATTERN, "")
		.replace(UNICODE_BIDI_FORMAT_CONTROL_PATTERN, "")
		// biome-ignore lint/suspicious/noControlCharactersInRegex: queue text is untrusted terminal output
		.replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, "");
}

function safeApprovalLineText(value: string): string {
	return stripApprovalTextControls(value).replace(/\n+/g, " ");
}

function printApprovalError(message: string): void {
	printToStderr(line(span(message, "error")));
}

function approvalValueHasRedaction(value: PendingApproval["input"][string]): boolean {
	if (value === "[redacted]") return true;
	if (Array.isArray(value)) return value.some((entry) => approvalValueHasRedaction(entry));
	if (typeof value !== "object" || value === null) return false;
	const record = value as { [key: string]: PendingApproval["input"][string] };
	if (record.redacted === true) return true;
	return Object.values(record).some((entry) => approvalValueHasRedaction(entry));
}

function approvalInputHasRedaction(input: PendingApproval["input"]): boolean {
	return Object.values(input).some((value) => approvalValueHasRedaction(value));
}

function executionRedactionSuffix(execution: ApprovalExecutionProjection): string {
	const bytes = execution.output.bytes !== undefined ? ` (${execution.output.bytes} bytes)` : "";
	return ` — output redacted by daemon policy${bytes}.`;
}

function exitInvalidApprovalId(id: string): never {
	printApprovalError(`Error: invalid approval id "${id}". Expected 8 lowercase hex characters.`);
	process.exit(1);
}

function exitApprovalMutationFailure(id: string, reason: "invalid_id" | "not_found" | "input_unavailable"): never {
	if (reason === "invalid_id") exitInvalidApprovalId(id);
	if (reason === "input_unavailable") {
		printApprovalError(
			`Error: approval "${id}" cannot be executed because its original input is no longer available after daemon restart. Reject it and retry the tool call.`,
		);
		process.exit(1);
	}
	printApprovalError(`Error: approval "${id}" not found or already resolved.`);
	process.exit(1);
}

function exitRedactedApprovalWithoutExecution(id: string, tool: string): never {
	printApprovalError(
		`Error: approved ${safeApprovalLineText(tool)} [${id}], but the returned input was redacted and no daemon execution result was provided.`,
	);
	process.exit(1);
}

function exitDaemonExecutionFailure(id: string, tool: string, execution: ApprovalExecutionProjection): never {
	printApprovalError(
		`Tool execution failed in daemon for [${id}] ${safeApprovalLineText(tool)}${executionRedactionSuffix(execution)}`,
	);
	process.exit(1);
}

function renderPendingItem(item: PendingApproval, opts?: { includeWhy?: boolean }): RenderNode {
	const inputSummary = safeApprovalLineText(JSON.stringify(item.input) ?? "").slice(0, 80);
	const rows: LineNode[] = [
		line(
			span(`  [${item.id}]`, "accent", true),
			plain(" "),
			plain(safeApprovalLineText(item.tool)),
			plain("  "),
			span(`(${formatAge(item.createdAt)})`, "muted"),
		),
		line(span("    Input:  ", "muted"), plain(inputSummary)),
		line(span("    Risk:   ", "muted"), span(item.risk, riskRole(item.risk))),
		line(span("    Reason: ", "muted"), plain(safeApprovalLineText(item.reason))),
	];
	if (item.source) rows.push(line(span("    Source: ", "muted"), plain(safeApprovalLineText(item.source))));
	if (opts?.includeWhy && item.context) {
		const safeContext = stripApprovalTextControls(item.context);
		const lastLine = safeContext.split("\n").filter(Boolean).at(-1) ?? "";
		rows.push(line(span("    Why:    ", "muted"), plain(safeApprovalLineText(lastLine).slice(0, 120))));
	}
	return stack(...rows, blank());
}

function renderResolvedItem(item: PendingApproval): RenderNode {
	const resolvedAgo = item.resolvedAt ? formatAge(item.resolvedAt) : "—";
	const rows: LineNode[] = [
		line(
			span(`  [${item.id}]`, "accent", true),
			plain(` ${safeApprovalLineText(item.tool)}  status=`),
			span(item.status, statusRole(item.status)),
			plain(`  resolved=${resolvedAgo}`),
		),
		line(span("    Risk:   ", "muted"), span(item.risk, riskRole(item.risk))),
	];
	if (item.rejectionReason && item.rejectionReason !== "expired") {
		rows.push(line(span("    Reason: ", "muted"), plain(safeApprovalLineText(item.rejectionReason))));
	}
	if (item.approvalNote) rows.push(line(span("    Note:   ", "muted"), plain(safeApprovalLineText(item.approvalNote))));
	if (item.source) rows.push(line(span("    Source: ", "muted"), plain(safeApprovalLineText(item.source))));
	return stack(...rows, blank());
}

export function registerApprovalCommands(program: Command, ctx: ModuleContext): void {
	const approvalCmd = program
		.command("approval")
		.description("Manage the tool-call approval queue");

	approvalCmd
		.command("list")
		.description("List all pending approval items")
		.action(async () => {
			const result = await ctx.client.approvals.list();
			const items = result.approvals.filter((a) => a.status === "pending");
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
			if (!isApprovalId(id)) exitInvalidApprovalId(id);
			const mutate = await ctx.client.approvals.approve(id, opts.note);
			if (!mutate.ok) {
				exitApprovalMutationFailure(id, mutate.reason);
			}
			const item = mutate.approval;
			if (mutate.execution) {
				if (mutate.execution.status === "failed") {
					exitDaemonExecutionFailure(id, item.tool, mutate.execution);
				}
				const noteSuffix = item.approvalNote ? ` — note: ${safeApprovalLineText(item.approvalNote)}` : "";
				print(line(
					span("Approved and executed ", "success"),
					plain(`${safeApprovalLineText(item.tool)} `),
					span(`[${id}]`, "accent"),
					plain(`${noteSuffix}${executionRedactionSuffix(mutate.execution)}`),
				));
				return;
			}
			if (approvalInputHasRedaction(item.input)) {
				exitRedactedApprovalWithoutExecution(id, item.tool);
			}
			const result = await executeTool(item.tool, item.input);
			if (result.is_error) {
				printApprovalError(`Tool execution failed:\n${stripApprovalTextControls(result.content)}`);
				process.exit(1);
			}
			const noteSuffix = item.approvalNote ? ` — note: ${safeApprovalLineText(item.approvalNote)}` : "";
			print(stack(
				line(
					span("Approved and executed ", "success"),
					plain(`${safeApprovalLineText(item.tool)}:`),
				),
				line(plain(`${stripApprovalTextControls(result.content)}${noteSuffix}`)),
			));
		});

	approvalCmd
		.command("approve-all")
		.description("Approve and execute all pending tool calls")
		.option("-y, --yes", "Skip confirmation prompt")
		.option("-n, --note <text>", "Note to attach to every approved item")
		.option("--risk <level>", "Only approve items of this risk level")
		.action(async (opts: { yes?: boolean; note?: string; risk?: string }) => {
			const listed = await ctx.client.approvals.list({ status: "pending" });
			let items = listed.approvals;
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
				const mutate = await ctx.client.approvals.approve(item.id, opts.note);
				if (!mutate.ok) {
					print(line(
						span("  Skipped ", "muted"),
						span(`[${item.id}]`, "accent"),
						plain(` ${safeApprovalLineText(item.tool)} — no longer pending.`),
					));
					continue;
				}
				const approved = mutate.approval;
				if (mutate.execution) {
					if (mutate.execution.status === "failed") {
						printApprovalError(
							`  Failed [${approved.id}] ${safeApprovalLineText(approved.tool)}${executionRedactionSuffix(mutate.execution)}`,
						);
						failed++;
						continue;
					}
					const noteSuffix = approved.approvalNote ? ` — note: ${safeApprovalLineText(approved.approvalNote)}` : "";
					print(line(
						span("  Approved and executed ", "success"),
						plain(`${safeApprovalLineText(approved.tool)} `),
						span(`[${approved.id}]`, "accent"),
						plain(`${noteSuffix}${executionRedactionSuffix(mutate.execution)}`),
					));
					succeeded++;
					continue;
				}
				if (approvalInputHasRedaction(approved.input)) {
					printApprovalError(
						`  Failed [${approved.id}] ${safeApprovalLineText(approved.tool)}: approved input was redacted and no daemon execution result was provided.`,
					);
					failed++;
					continue;
				}
				const result = await executeTool(approved.tool, approved.input);
				if (result.is_error) {
					printApprovalError(`  Failed [${item.id}] ${safeApprovalLineText(item.tool)}: ${stripApprovalTextControls(result.content)}`);
					failed++;
				} else {
					const noteSuffix = approved.approvalNote ? ` — note: ${safeApprovalLineText(approved.approvalNote)}` : "";
					print(line(
						span("  Approved and executed ", "success"),
						plain(`${safeApprovalLineText(item.tool)} `),
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
		.action(async (id: string, opts: { reason?: string }) => {
			if (!isApprovalId(id)) exitInvalidApprovalId(id);
			const mutate = await ctx.client.approvals.reject(id, opts.reason);
			if (!mutate.ok) {
				exitApprovalMutationFailure(id, mutate.reason);
			}
			const item = mutate.approval;
			const suffix = opts.reason ? ` — ${safeApprovalLineText(opts.reason)}` : "";
			print(line(
				span("Rejected: ", "error"),
				plain(`${safeApprovalLineText(item.tool)} `),
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
			const listed = await ctx.client.approvals.list({ status: "pending" });
			let items = listed.approvals;
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
				const mutate = await ctx.client.approvals.reject(item.id, opts.reason);
				if (!mutate.ok) {
					print(line(
						span("  Skipped ", "muted"),
						span(`[${item.id}]`, "accent"),
						plain(` ${safeApprovalLineText(item.tool)} — no longer pending.`),
					));
					continue;
				}
				const reasonSuffix = opts.reason ? ` — ${safeApprovalLineText(opts.reason)}` : "";
				print(line(
					span("  Rejected ", "error"),
					plain(`${safeApprovalLineText(item.tool)} `),
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
		.action(async () => {
			const result = await ctx.client.approvals.list({ status: "pending" });
			writeStdoutLine(String(result.approvals.length));
		});

	approvalCmd
		.command("history")
		.description("List resolved and expired approvals")
		.option("--status <status>", "Filter by status: approved, rejected, expired")
		.option("-n <count>", "Max results to show (default 20)", "20")
		.option("--since <duration>", "Only show items resolved within this window (e.g. 1h, 24h, 7d)")
		.action(async (opts: { status?: string; n: string; since?: string }) => {
			const limit = Math.max(1, parseInt(opts.n, 10) || 20);

			const statusFilter = opts.status as ApprovalStatus | undefined;
			const validStatuses: ApprovalStatus[] = ["approved", "rejected", "expired"];
			if (statusFilter && !validStatuses.includes(statusFilter)) {
				printApprovalError(`Error: invalid --status "${statusFilter}". Must be one of: ${validStatuses.join(", ")}`);
				process.exit(1);
			}

			let sinceMs: number | null = null;
			if (opts.since) {
				sinceMs = parseDuration(opts.since);
				if (sinceMs === null) {
					printApprovalError(`Error: invalid --since "${opts.since}". Use format like 1h, 24h, 7d.`);
					process.exit(1);
				}
			}

			const cutoff = sinceMs !== null ? Date.now() - sinceMs : null;

			const all = await ctx.client.approvals.list({ status: "all" });
			const items = all.approvals
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
