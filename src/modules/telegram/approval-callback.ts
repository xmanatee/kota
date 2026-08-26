import type { ModuleContext } from "#core/modules/module-types.js";
import type {
	ApprovalApproveResult,
	ApprovalRejectResult,
} from "#modules/approval-queue/client.js";
import { buildLocalApprovalsClient } from "#modules/approval-queue/local-client.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";
import {
	callTelegramApi,
	type TelegramApiBody,
	type TelegramCallbackQuery,
} from "./client.js";
import type { PendingMessage } from "./owner-question-reply.js";

export type PendingApprovalMessage = PendingMessage & {
	approvalId: string;
	reviewDigest: string;
};

export type ApprovalCallbackAction = "approve" | "reject";

const REVIEW_DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const CALLBACK_RECEIPT_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function buildApprovalCallbackData(
	action: ApprovalCallbackAction,
	reviewDigest: string,
): string {
	return `${action}:${approvalReviewReceipt(reviewDigest)}`;
}

function approvalReviewReceipt(reviewDigest: string): string {
	if (!REVIEW_DIGEST_PATTERN.test(reviewDigest)) {
		throw new Error("Telegram approval callback requires a SHA-256 review digest");
	}
	return Buffer.from(reviewDigest, "hex").toString("base64url");
}

export function parseApprovalCallbackData(
	data: string,
): { action: ApprovalCallbackAction; reviewReceipt: string } | null {
	const match = /^(approve|reject):(.+)$/.exec(data);
	if (!match || !CALLBACK_RECEIPT_PATTERN.test(match[2])) return null;
	return {
		action: match[1] === "approve" ? "approve" : "reject",
		reviewReceipt: match[2],
	};
}

export function pendingApprovalMessageKey(
	chatId: string | number,
	messageId: number,
): string {
	return JSON.stringify([String(chatId), messageId]);
}

export async function handleApprovalCallback(
	token: string,
	callback: TelegramCallbackQuery,
	action: ApprovalCallbackAction,
	reviewReceipt: string,
	pending: Map<string, PendingApprovalMessage>,
	client: KotaClient | undefined,
	log?: ModuleContext["log"],
): Promise<void> {
	const message = callback.message;
	if (!message) {
		await answerUnavailableApprovalCallback(token, callback.id, log);
		return;
	}
	const pendingKey = pendingApprovalMessageKey(message.chat.id, message.message_id);
	const info = pending.get(pendingKey);
	if (!info || approvalReviewReceipt(info.reviewDigest) !== reviewReceipt) {
		await answerUnavailableApprovalCallback(token, callback.id, log);
		return;
	}
	const approvalId = info.approvalId;
	const mutate = client
		? action === "approve"
			? await client.forScope(info.scopeId).approvals.approve(approvalId, info.reviewDigest)
			: await client.forScope(info.scopeId).approvals.reject(approvalId)
		: await resolveLocalApproval(action, approvalId, info);

	if (!mutate.ok) {
		pending.delete(pendingKey);
		await answerUnavailableApprovalCallback(token, callback.id, log);
		return;
	}
	pending.delete(pendingKey);

	const resolution = action === "approve"
		? (mutate as Extract<ApprovalApproveResult, { ok: true }>).resolution
		: undefined;
	const execution = resolution?.kind === "tool_execution"
		? resolution.execution
		: undefined;
	const workflowGateApproved = resolution?.kind === "workflow_gate_approved";
	const executionFailed = action === "approve"
		&& execution?.status === "failed";
	const executionSucceeded = action === "approve"
		&& execution?.status === "succeeded";
	const label = action === "reject"
		? "❌ Rejected"
		: executionFailed
			? "⚠️ Approved; execution failed"
			: workflowGateApproved
				? "✅ Workflow gate approved"
			: executionSucceeded
				? "✅ Approved and executed"
				: "✅ Approved";
	await sendCallbackUpdate(token, "answerCallbackQuery", {
		callback_query_id: callback.id,
		text: action === "reject"
			? "Rejected!"
			: executionFailed
				? "Approved, but execution failed."
				: workflowGateApproved
					? "Workflow gate approved!"
				: executionSucceeded
					? "Approved and executed!"
					: "Approved!",
	}, log);

	const resolved = mutate.approval;
	await sendCallbackUpdate(token, "editMessageText", {
		chat_id: info.chatId,
		message_id: info.messageId,
		text: [
			`${label}: ${resolved.tool}`,
			`Risk: ${resolved.risk}`,
			`Reason: ${resolved.reason}`,
			`ID: ${approvalId}`,
			"",
			`kota approval approve ${approvalId}`,
			`kota approval reject ${approvalId}`,
		].join("\n"),
	}, log);
}

async function answerUnavailableApprovalCallback(
	token: string,
	callbackId: string,
	log?: ModuleContext["log"],
): Promise<void> {
	await sendCallbackUpdate(token, "answerCallbackQuery", {
		callback_query_id: callbackId,
		text: "Approval already resolved or not found.",
		show_alert: true,
	}, log);
}

async function sendCallbackUpdate(
	token: string,
	method: "answerCallbackQuery" | "editMessageText",
	payload: TelegramApiBody,
	log?: ModuleContext["log"],
): Promise<void> {
	try {
		await callTelegramApi(token, method, payload);
	} catch (error) {
		if (log === undefined) throw error;
		log.warn(`Telegram ${method} failed: ${(error as Error).message}`);
	}
}

async function resolveLocalApproval(
	action: ApprovalCallbackAction,
	approvalId: string,
	info: PendingApprovalMessage,
): Promise<ApprovalApproveResult | ApprovalRejectResult> {
	const approvals = buildLocalApprovalsClient();
	if (action === "reject") {
		return approvals.reject(
			approvalId,
			undefined,
			{ scopeId: info.scopeId },
		);
	}
	return approvals.approve(
		approvalId,
		info.reviewDigest,
		undefined,
		{ scopeId: info.scopeId },
	);
}
