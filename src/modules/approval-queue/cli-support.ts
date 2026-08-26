import { createInterface } from "node:readline";
import {
	type ApprovalClientProjection,
	type ApprovalStatus,
	isApprovalId,
	type PendingApproval,
} from "#core/daemon/approval-queue.js";
import {
	blank,
	type LineNode,
	line,
	plain,
	type RenderNode,
	span,
	stack,
} from "#modules/rendering/primitives.js";
import { safeTerminalLineText } from "#modules/rendering/safe-terminal-text.js";
import { printToStderr } from "#modules/rendering/transport.js";
import type { ApprovalExecutionProjection } from "./client.js";

export function promptConfirm(message: string): Promise<boolean> {
	const prompt = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		prompt.question(message, (answer) => {
			prompt.close();
			resolve(answer.toLowerCase().startsWith("y"));
		});
	});
}

export function parseDuration(value: string): number | null {
	const match = /^(\d+)(h|m|d)$/.exec(value);
	if (!match) return null;
	const amount = parseInt(match[1], 10);
	if (match[2] === "h") return amount * 3_600_000;
	if (match[2] === "m") return amount * 60_000;
	return amount * 86_400_000;
}

export function safeApprovalLineText(value: string): string {
	return safeTerminalLineText(value);
}

export function printApprovalError(message: string): void {
	printToStderr(line(span(message, "error")));
}

export function approvalInputHasRedaction(input: PendingApproval["input"]): boolean {
	return Object.values(input).some(approvalValueHasRedaction);
}

export function executionRedactionSuffix(execution: ApprovalExecutionProjection): string {
	const bytes = execution.output.bytes !== undefined ? ` (${execution.output.bytes} bytes)` : "";
	return ` — output redacted by daemon policy${bytes}.`;
}

export function exitInvalidApprovalId(id: string): never {
	printApprovalError(`Error: invalid approval id "${id}". Expected 8 lowercase hex characters.`);
	process.exit(1);
}

export function requireApprovalId(id: string): void {
	if (!isApprovalId(id)) exitInvalidApprovalId(id);
}

export function exitApprovalMutationFailure(
	id: string,
	reason: "invalid_id" | "not_found" | "input_unavailable" | "scope_mismatch" | "review_mismatch",
): never {
	if (reason === "invalid_id") exitInvalidApprovalId(id);
	if (reason === "scope_mismatch") {
		printApprovalError(
			`Error: approval "${id}" belongs to a different scope and cannot be resolved here.`,
		);
		process.exit(1);
	}
	if (reason === "input_unavailable") {
		printApprovalError(
			`Error: approval "${id}" cannot be executed because its original input is no longer available after daemon restart. Reject it and retry the tool call.`,
		);
		process.exit(1);
	}
	if (reason === "review_mismatch") {
		printApprovalError(
			`Error: approval "${id}" changed after it was reviewed. Refresh the queue and review the current operation before approving it.`,
		);
		process.exit(1);
	}
	printApprovalError(`Error: approval "${id}" not found or already resolved.`);
	process.exit(1);
}

export function exitRedactedApprovalWithoutExecution(id: string, tool: string): never {
	printApprovalError(
		`Error: approved ${safeApprovalLineText(tool)} [${id}], but the returned input was redacted and no daemon execution result was provided.`,
	);
	process.exit(1);
}

export function exitDaemonExecutionFailure(
	id: string,
	tool: string,
	execution: ApprovalExecutionProjection,
): never {
	printApprovalError(
		`Tool execution failed in daemon for [${id}] ${safeApprovalLineText(tool)}${executionRedactionSuffix(execution)}`,
	);
	process.exit(1);
}

export function renderPendingItem(item: ApprovalClientProjection): RenderNode {
	const reviewInput = item.review.status === "available"
		? safeApprovalLineText(JSON.stringify(item.review.input) ?? "")
		: "[input unavailable after daemon restart]";
	const rows: LineNode[] = [
		line(
			span(`  [${item.id}]`, "accent", true),
			plain(" "),
			plain(safeApprovalLineText(item.tool)),
			plain("  "),
			span(`(${formatAge(item.createdAt)})`, "muted"),
		),
		line(span("    Input:  ", "muted"), plain(reviewInput)),
		...(item.review.status === "available"
			? [
					...(item.review.context !== undefined
						? [line(span("    Context: ", "muted"), plain(safeApprovalLineText(item.review.context)))]
						: []),
					line(span("    Digest: ", "muted"), plain(item.review.digest)),
				]
			: []),
		line(span("    Risk:   ", "muted"), span(item.risk, riskRole(item.risk))),
		line(span("    Reason: ", "muted"), plain(safeApprovalLineText(item.reason))),
	];
	if (item.source) {
		rows.push(line(span("    Source: ", "muted"), plain(safeApprovalLineText(item.source))));
	}
	return stack(...rows, blank());
}

export function renderResolvedItem(item: PendingApproval): RenderNode {
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
	if (item.approvalNote) {
		rows.push(line(span("    Note:   ", "muted"), plain(safeApprovalLineText(item.approvalNote))));
	}
	if (item.source) {
		rows.push(line(span("    Source: ", "muted"), plain(safeApprovalLineText(item.source))));
	}
	return stack(...rows, blank());
}

function approvalValueHasRedaction(value: PendingApproval["input"][string]): boolean {
	if (value === "[redacted]") return true;
	if (Array.isArray(value)) return value.some(approvalValueHasRedaction);
	if (typeof value !== "object" || value === null) return false;
	const record = value as { [key: string]: PendingApproval["input"][string] };
	if (record.redacted === true) return true;
	return Object.values(record).some(approvalValueHasRedaction);
}

function formatAge(createdAt: string): string {
	const ageMs = Date.now() - new Date(createdAt).getTime();
	const minutes = Math.floor(ageMs / 60_000);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(ageMs / 3_600_000);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(ageMs / 86_400_000)}d ago`;
}

function riskRole(risk: string): "error" | "warn" | "info" | "muted" | "success" {
	if (risk === "critical" || risk === "dangerous") return "error";
	if (risk === "moderate") return "warn";
	if (risk === "low") return "info";
	if (risk === "safe") return "success";
	return "muted";
}

function statusRole(status: ApprovalStatus): "success" | "error" | "muted" | "warn" | "accent" {
	if (status === "approved") return "success";
	if (status === "rejected") return "error";
	if (status === "expired") return "warn";
	return "accent";
}
