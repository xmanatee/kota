import type { Command } from "commander";
import {
	isWorkflowStepApproval,
	type PendingApproval,
} from "#core/daemon/approval-queue.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { executeTool } from "#core/tools/index.js";
import { blank, line, plain, span, stack } from "#modules/rendering/primitives.js";
import { stripTerminalTextControls } from "#modules/rendering/safe-terminal-text.js";
import { print } from "#modules/rendering/transport.js";
import {
	approvalInputHasRedaction,
	executionRedactionSuffix,
	exitApprovalMutationFailure,
	exitDaemonExecutionFailure,
	exitRedactedApprovalWithoutExecution,
	printApprovalError,
	promptConfirm,
	renderPendingItem,
	requireApprovalId,
	safeApprovalLineText,
} from "./cli-support.js";
import type { ApprovalExecutionProjection } from "./client.js";

export function registerApprovalApproveCommands(command: Command, ctx: ModuleContext): void {
	command
		.command("approve <id>")
		.description("Approve and execute a queued tool call")
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
			const workflowApproval = isWorkflowStepApproval(selected);
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
			if (isWorkflowStepApproval(item)) {
				const note = item.approvalNote ? ` — note: ${safeApprovalLineText(item.approvalNote)}` : "";
				print(line(
					span("Approved workflow gate ", "success"),
					plain(`${safeApprovalLineText(item.tool)} `),
					span(`[${id}]`, "accent"),
					plain(note),
				));
				return;
			}
			if (mutate.execution) {
				if (mutate.execution.status === "failed") {
					exitDaemonExecutionFailure(id, item.tool, mutate.execution);
				}
				const note = item.approvalNote ? ` — note: ${safeApprovalLineText(item.approvalNote)}` : "";
				print(line(
					span("Approved and executed ", "success"),
					plain(`${safeApprovalLineText(item.tool)} `),
					span(`[${id}]`, "accent"),
					plain(`${note}${executionRedactionSuffix(mutate.execution)}`),
				));
				return;
			}
			if (approvalInputHasRedaction(item.input)) {
				exitRedactedApprovalWithoutExecution(id, item.tool);
			}
			const result = await executeTool(item.tool, item.input);
			if (result.is_error) {
				printApprovalError(`Tool execution failed:\n${stripTerminalTextControls(result.content)}`);
				process.exit(1);
			}
			const note = item.approvalNote ? ` — note: ${safeApprovalLineText(item.approvalNote)}` : "";
			print(stack(
				line(span("Approved and executed ", "success"), plain(`${safeApprovalLineText(item.tool)}:`)),
				line(plain(`${stripTerminalTextControls(result.content)}${note}`)),
			));
		});

	command
		.command("approve-all")
		.description("Approve and execute all pending tool calls")
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
				const outcome = await executeApprovedItem(mutate.approval, mutate.execution);
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

async function executeApprovedItem(
	item: PendingApproval,
	execution: ApprovalExecutionProjection | undefined,
): Promise<boolean> {
	const note = item.approvalNote ? ` — note: ${safeApprovalLineText(item.approvalNote)}` : "";
	if (isWorkflowStepApproval(item)) {
		print(line(
			span("  Approved workflow gate ", "success"),
			plain(`${safeApprovalLineText(item.tool)} `),
			span(`[${item.id}]`, "accent"),
			plain(note),
		));
		return true;
	}
	if (execution) {
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
	if (approvalInputHasRedaction(item.input)) {
		printApprovalError(
			`  Failed [${item.id}] ${safeApprovalLineText(item.tool)}: approved input was redacted and no daemon execution result was provided.`,
		);
		return false;
	}
	const result = await executeTool(item.tool, item.input);
	if (result.is_error) {
		printApprovalError(
			`  Failed [${item.id}] ${safeApprovalLineText(item.tool)}: ${stripTerminalTextControls(result.content)}`,
		);
		return false;
	}
	print(line(
		span("  Approved and executed ", "success"),
		plain(`${safeApprovalLineText(item.tool)} `),
		span(`[${item.id}]`, "accent"),
		plain(note),
	));
	return true;
}
