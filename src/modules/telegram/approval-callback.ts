import type { KotaClient } from "#core/server/kota-client.js";
import type { ApprovalMutateResult } from "#modules/approval-queue/client.js";
import { getApprovalQueue } from "#modules/approval-queue/index.js";
import { callTelegramApi, type TelegramCallbackQuery } from "./client.js";
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
): Promise<void> {
	const message = callback.message;
	if (!message) {
		await answerUnavailableApprovalCallback(token, callback.id);
		return;
	}
	const pendingKey = pendingApprovalMessageKey(message.chat.id, message.message_id);
	const info = pending.get(pendingKey);
	if (!info || approvalReviewReceipt(info.reviewDigest) !== reviewReceipt) {
		await answerUnavailableApprovalCallback(token, callback.id);
		return;
	}
	const approvalId = info.approvalId;
	const mutate = client
		? action === "approve"
			? await client.forProject(info.projectId).approvals.approve(approvalId, info.reviewDigest)
			: await client.forProject(info.projectId).approvals.reject(approvalId)
		: resolveLocalApproval(action, approvalId, info);

	if (!mutate.ok) {
		await answerUnavailableApprovalCallback(token, callback.id);
		return;
	}

	const execution = "execution" in mutate ? mutate.execution : undefined;
	const executionFailed = action === "approve"
		&& execution?.status === "failed";
	const executionSucceeded = action === "approve"
		&& execution?.status === "succeeded";
	const label = action === "reject"
		? "❌ Rejected"
		: executionFailed
			? "⚠️ Approved; execution failed"
			: executionSucceeded
				? "✅ Approved and executed"
				: "✅ Approved";
	await callTelegramApi(token, "answerCallbackQuery", {
		callback_query_id: callback.id,
		text: action === "reject"
			? "Rejected!"
			: executionFailed
				? "Approved, but execution failed."
				: executionSucceeded
					? "Approved and executed!"
					: "Approved!",
	}).catch(() => {});

	const resolved = mutate.approval;
	await callTelegramApi(token, "editMessageText", {
		chat_id: info.chatId,
		message_id: info.messageId,
		text: [
			`${label}: *${resolved.tool}*`,
			`Risk: ${resolved.risk}`,
			`Reason: ${resolved.reason}`,
			`ID: \`${approvalId}\``,
			"",
			`kota approval approve ${approvalId}`,
			`kota approval reject ${approvalId}`,
		].join("\n"),
		parse_mode: "Markdown",
	}).catch(() => {});
	pending.delete(pendingKey);
}

async function answerUnavailableApprovalCallback(
	token: string,
	callbackId: string,
): Promise<void> {
	await callTelegramApi(token, "answerCallbackQuery", {
		callback_query_id: callbackId,
		text: "Approval already resolved or not found.",
		show_alert: true,
	}).catch(() => {});
}

function resolveLocalApproval(
	action: ApprovalCallbackAction,
	approvalId: string,
	info: PendingApprovalMessage,
): ApprovalMutateResult {
	const queue = getApprovalQueue();
	if (action === "reject") {
		const approval = queue.reject(approvalId, undefined, "telegram-inline");
		return approval
			? { ok: true as const, approval }
			: { ok: false as const, reason: "not_found" as const };
	}
	const selection = queue.getExecutionSnapshot(approvalId);
	if (!selection.ok || selection.snapshot.descriptor.reviewDigest !== info.reviewDigest) {
		return { ok: false as const, reason: "not_found" as const };
	}
	const result = queue.approveForExecution(
		selection.snapshot.descriptor,
		undefined,
		"telegram-inline",
	);
	if (!result.ok) {
		return {
			ok: false,
			reason: result.reason === "descriptor_mismatch"
				? "review_mismatch"
				: result.reason,
		};
	}
	return result;
}
