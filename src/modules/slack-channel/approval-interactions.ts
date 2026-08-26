import type { ApprovalClientProjection } from "#core/daemon/approval-queue.js";
import { printTerminalDiagnostic } from "#core/modules/terminal-renderer.js";
import type { SlackApprovalBindingStore } from "./approval-bindings.js";
import type { SlackBotOptions } from "./bot-options.js";
import { callSlackApi, type SlackInteractivePayload } from "./client.js";

export async function postSlackApproval(
	options: SlackBotOptions,
	approval: ApprovalClientProjection,
): Promise<{ channelId: string; messageTs: string } | null> {
	if (!options.notifyChannel) return null;
	const posted = await callSlackApi<{ channel: string; ts: string }>(options.botToken, "chat.postMessage", {
		channel: options.notifyChannel,
		blocks: buildApprovalBlocks(approval),
		text: `Approval required: ${approval.tool}`,
	});
	return { channelId: posted.channel, messageTs: posted.ts };
}

export async function handleSlackApprovalAction(
	options: SlackBotOptions,
	payload: SlackInteractivePayload,
	bindings: SlackApprovalBindingStore,
): Promise<void> {
	for (const action of payload.actions) {
		const [verb, scopeId, id, reviewDigest] = (action.value ?? "").split(":");
		if (verb !== "approve" && verb !== "reject") continue;
		const binding = bindings.get(payload.channel.id, payload.message.ts);
		if (
			!scopeId || !id || !reviewDigest ||
			action.action_id !== `${verb}:${id}` ||
			binding === null ||
			binding.scopeId !== scopeId ||
			binding.approvalId !== id ||
			binding.reviewDigest !== reviewDigest
		) {
			await updateApprovalMessage(options, payload, "Approval binding is stale or invalid.");
			continue;
		}

		const approvals = options.getApprovals(scopeId);
		let resultText: string;
		let resolved = false;
		if (verb === "approve") {
			const result = await approvals.approve(id, reviewDigest);
			resolved = result.ok;
			resultText = !result.ok
				? `Approval \`${id}\` changed, is unavailable, or was already resolved.`
				: result.resolution.kind === "workflow_gate_approved"
					? `Approved workflow gate: \`${result.approval.tool}\``
					: result.resolution.execution.status === "failed"
					? `Approved, but execution failed: \`${result.approval.tool}\``
					: `Approved and executed: \`${result.approval.tool}\``;
		} else if (verb === "reject") {
			const listed = await approvals.list({ status: "pending" });
			const current = listed.approvals.find((approval) => approval.id === id);
			if (current?.review.status !== "available" || current.review.digest !== reviewDigest) {
				await updateApprovalMessage(options, payload, `Approval \`${id}\` changed, is unavailable, or was already resolved.`);
				continue;
			}
			const result = await approvals.reject(id);
			resolved = result.ok;
			resultText = result.ok
				? `Rejected: \`${result.approval.tool}\``
				: `Approval \`${id}\` not found or already resolved.`;
		} else {
			continue;
		}

		if (resolved) {
			bindings.delete(payload.channel.id, payload.message.ts);
		}
		await updateApprovalMessage(options, payload, resultText);
	}
}

async function updateApprovalMessage(
	options: SlackBotOptions,
	payload: SlackInteractivePayload,
	resultText: string,
): Promise<void> {
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
							value: `approve:${approval.scopeId}:${approval.id}:${review.digest}`,
						}]
					: []),
				{
					type: "button",
					text: { type: "plain_text", text: "Reject" },
					style: "danger",
					action_id: `reject:${approval.id}`,
					value: review.status === "available"
						? `reject:${approval.scopeId}:${approval.id}:${review.digest}`
						: `reject:${approval.scopeId}:${approval.id}:unavailable`,
				},
			],
		},
	];
}
