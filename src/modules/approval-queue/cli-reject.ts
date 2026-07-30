import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { blank, line, plain, span, stack } from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import {
	exitApprovalMutationFailure,
	promptConfirm,
	renderPendingItem,
	requireApprovalId,
	safeApprovalLineText,
} from "./cli-support.js";

export function registerApprovalRejectCommands(command: Command, ctx: ModuleContext): void {
	command
		.command("reject <id>")
		.description("Reject a queued tool call")
		.option("-r, --reason <text>", "Reason for rejection")
		.action(async (id: string, opts: { reason?: string }) => {
			requireApprovalId(id);
			const mutate = await ctx.client.approvals.reject(id, opts.reason);
			if (!mutate.ok) exitApprovalMutationFailure(id, mutate.reason);
			const suffix = opts.reason ? ` — ${safeApprovalLineText(opts.reason)}` : "";
			print(line(
				span("Rejected: ", "error"),
				plain(`${safeApprovalLineText(mutate.approval.tool)} `),
				span(`[${id}]`, "accent"),
				plain(suffix),
			));
		});

	command
		.command("reject-all")
		.description("Reject all pending tool calls")
		.option("-y, --yes", "Skip confirmation prompt")
		.option("-r, --reason <text>", "Reason to attach to every rejected item")
		.option("--risk <level>", "Only reject items of this risk level")
		.action(async (opts: { yes?: boolean; reason?: string; risk?: string }) => {
			const listed = await ctx.client.approvals.list({ status: "pending" });
			const items = opts.risk
				? listed.approvals.filter((item) => item.risk === opts.risk)
				: listed.approvals;
			if (items.length === 0) {
				const qualifier = opts.risk ? ` with risk level "${opts.risk}"` : "";
				print(line(plain(`No pending approvals${qualifier}.`)));
				return;
			}

			print(stack(
				line(span(String(items.length), "accent", true), plain(" pending approval(s) to be rejected:")),
				blank(),
				...items.map(renderPendingItem),
			));
			if (!opts.yes && !await promptConfirm(`Reject all ${items.length} item(s)? [y/N] `)) {
				print(line(span("Aborted.", "muted")));
				return;
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
				const reason = opts.reason ? ` — ${safeApprovalLineText(opts.reason)}` : "";
				print(line(
					span("  Rejected ", "error"),
					plain(`${safeApprovalLineText(item.tool)} `),
					span(`[${item.id}]`, "accent"),
					plain(reason),
				));
				rejected += 1;
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
}
