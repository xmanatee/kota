import type { ApprovalClientProjection } from "#core/daemon/approval-queue.js";
import { printTerminalDiagnostic } from "#core/modules/terminal-renderer.js";
import type { SlackBotOptions } from "./bot-options.js";
import { callSlackApi, type SlackInteractivePayload } from "./client.js";

export async function postSlackApproval(
	options: SlackBotOptions,
	approval: ApprovalClientProjection,
): Promise<void> {
	if (!options.notifyChannel) return;
	await callSlackApi(options.botToken, "chat.postMessage", {
		channel: options.notifyChannel,
		blocks: buildApprovalBlocks(approval),
		text: `Approval required: ${approval.tool}`,
	});
}

export async function handleSlackApprovalAction(
	options: SlackBotOptions,
	payload: SlackInteractivePayload,
): Promise<void> {
	for (const action of payload.actions) {
		const [verb, id, reviewDigest] = (action.value ?? action.action_id).split(":");
		if (!id) continue;

		let resultText: string;
		if (verb === "approve") {
			const result = reviewDigest
				? await options.approvals.approve(id, reviewDigest)
				: { ok: false as const, reason: "review_mismatch" as const };
			resultText = !result.ok
				? `Approval \`${id}\` changed, is unavailable, or was already resolved.`
				: result.resolution.kind === "workflow_gate_approved"
					? `Approved workflow gate: \`${result.approval.tool}\``
					: result.resolution.execution.status === "failed"
					? `Approved, but execution failed: \`${result.approval.tool}\``
					: `Approved and executed: \`${result.approval.tool}\``;
		} else if (verb === "reject") {
			const result = await options.approvals.reject(id);
			resultText = result.ok
				? `Rejected: \`${result.approval.tool}\``
				: `Approval \`${id}\` not found or already resolved.`;
		} else {
			continue;
		}

		await callSlackApi(options.botToken, "chat.update", {
			channel: payload.channel.id,
			ts: payload.message.ts,
			text: resultText,
			blocks: [{ type: "section", text: { type: "mrkdwn", text: resultText } }],
		}).catch((error) => {
			printTerminalDiagnostic(
				"[kota-slack] Failed to update approval message:",
				"error",
				error instanceof Error ? error.message : String(error),
			);
		});
	}
}

function buildApprovalBlocks(approval: ApprovalClientProjection) {
	const review = approval.review;
	const detail = review.status === "available"
		? [
				`Reviewed input: ${JSON.stringify(review.input)}`,
				...(review.context !== undefined ? [`Conversation context: ${review.context}`] : []),
				`Review digest: ${review.digest}`,
			]
		: ["Input unavailable after daemon restart. Reject and retry the tool call."];
	return [
		{
			type: "section",
			text: {
				type: "plain_text",
				text: [
					"Approval Required",
					`Tool: ${approval.tool}`,
					`Risk: ${approval.risk}`,
					`Reason: ${approval.reason}`,
					...detail,
					`ID: ${approval.id}`,
				].join("\n"),
			},
		},
		{
			type: "actions",
			elements: [
				...(review.status === "available"
					? [{
							type: "button",
							text: { type: "plain_text", text: "Approve" },
							style: "primary",
							action_id: `approve:${approval.id}`,
							value: `approve:${approval.id}:${review.digest}`,
						}]
					: []),
				{
					type: "button",
					text: { type: "plain_text", text: "Reject" },
					style: "danger",
					action_id: `reject:${approval.id}`,
					value: `reject:${approval.id}`,
				},
			],
		},
	];
}
