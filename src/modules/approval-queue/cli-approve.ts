import type { Command } from "commander";
import {
	isWorkflowGateApproval,
	type PendingApproval,
} from "#core/daemon/approval-queue.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { blank, line, plain, span, stack } from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import {
	executionRedactionSuffix,
	exitApprovalMutationFailure,
	exitDaemonExecutionFailure,
	printApprovalError,
	promptConfirm,
	renderPendingItem,
	requireApprovalId,
	safeApprovalLineText,
} from "./cli-support.js";
import type { ApprovalResolutionProjection } from "./client.js";

export function registerApprovalApproveCommands(command: Command, ctx: ModuleContext): void {
	command
		.command("approve <id>")
		.description("Approve a queued tool call or workflow gate")
		.option("-n, --note <text>", "Note to attach with the approval")
		.action(async (id: string, opts: { note?: string }) => {
			requireApprovalId(id);
			const listed = await ctx.client.approvals.list({ status: "pending" });
			const selected = listed.approvals.find((item) => item.id === id);
			if (selected === undefined) exitApprovalMutationFailure(id, "not_found");
			if (selected.review.status !== "available") {
				exitApprovalMutationFailure(id, "input_unavailable");
			}
			print(stack(
				line(span("Reviewing exact operation:", "warn", true)),
				blank(),
				renderPendingItem(selected),
			));
			const workflowApproval = isWorkflowGateApproval(selected);
			const confirmation = workflowApproval
				? "Approve this exact workflow gate? [y/N] "
				: "Approve and execute this exact operation? [y/N] ";
			if (!await promptConfirm(confirmation)) {
				print(line(span("Aborted.", "muted")));
				return;
			}
			const mutate = await ctx.client.approvals.approve(id, selected.review.digest, opts.note);
			if (!mutate.ok) exitApprovalMutationFailure(id, mutate.reason);
			const item = mutate.approval;
			if (mutate.resolution.kind === "workflow_gate_approved") {
				const note = item.approvalNote ? ` — note: ${safeApprovalLineText(item.approvalNote)}` : "";
				print(line(
					span("Approved workflow gate ", "success"),
					plain(`${safeApprovalLineText(item.tool)} `),
					span(`[${id}]`, "accent"),
					plain(note),
				));
				return;
			}
			const execution = mutate.resolution.execution;
			if (execution.status === "failed") {
				exitDaemonExecutionFailure(id, item.tool, execution);
			}
			const note = item.approvalNote ? ` — note: ${safeApprovalLineText(item.approvalNote)}` : "";
			print(line(
				span("Approved and executed ", "success"),
				plain(`${safeApprovalLineText(item.tool)} `),
				span(`[${id}]`, "accent"),
				plain(`${note}${executionRedactionSuffix(execution)}`),
			));
		});

	command
		.command("approve-all")
		.description("Approve all pending tool calls and workflow gates")
		.option("-y, --yes", "Skip confirmation prompt")
		.option("-n, --note <text>", "Note to attach to every approved item")
		.option("--risk <level>", "Only approve items of this risk level")
		.action(async (opts: { yes?: boolean; note?: string; risk?: string }) => {
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
				line(span(String(items.length), "accent", true), plain(" pending approval(s) to be approved:")),
				blank(),
				...items.map(renderPendingItem),
			));
			if (!opts.yes && !await promptConfirm(`Approve all ${items.length} item(s)? [y/N] `)) {
				print(line(span("Aborted.", "muted")));
				return;
			}

			let succeeded = 0;
			let failed = 0;
			for (const item of items) {
				if (item.review.status !== "available") {
					print(line(
						span("  Skipped ", "muted"),
						span(`[${item.id}]`, "accent"),
						plain(` ${safeApprovalLineText(item.tool)} — input unavailable.`),
					));
					continue;
				}
				const mutate = await ctx.client.approvals.approve(item.id, item.review.digest, opts.note);
				if (!mutate.ok) {
					print(line(
						span("  Skipped ", "muted"),
						span(`[${item.id}]`, "accent"),
						plain(` ${safeApprovalLineText(item.tool)} — no longer pending.`),
					));
					continue;
				}
				const outcome = executeApprovedItem(mutate.approval, mutate.resolution);
				if (outcome) succeeded += 1;
				else failed += 1;
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
}

function executeApprovedItem(
	item: PendingApproval,
	resolution: ApprovalResolutionProjection,
): boolean {
	const note = item.approvalNote ? ` — note: ${safeApprovalLineText(item.approvalNote)}` : "";
	if (resolution.kind === "workflow_gate_approved") {
		print(line(
			span("  Approved workflow gate ", "success"),
			plain(`${safeApprovalLineText(item.tool)} `),
			span(`[${item.id}]`, "accent"),
			plain(note),
		));
		return true;
	}
	const execution = resolution.execution;
	if (execution.status === "failed") {
		printApprovalError(
			`  Failed [${item.id}] ${safeApprovalLineText(item.tool)}${executionRedactionSuffix(execution)}`,
		);
		return false;
	}
	print(line(
		span("  Approved and executed ", "success"),
		plain(`${safeApprovalLineText(item.tool)} `),
		span(`[${item.id}]`, "accent"),
		plain(`${note}${executionRedactionSuffix(execution)}`),
	));
	return true;
}
