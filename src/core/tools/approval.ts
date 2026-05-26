/**
 * Approval tool — inspect queued tool calls requiring human approval.
 *
 * When guardrails queue a tool call (dangerous operations in autonomous contexts),
 * this tool lets the agent list pending items. Resolution stays on
 * operator-authenticated CLI and daemon-control surfaces.
 */

import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import { getApprovalQueue } from "#core/daemon/approval-queue.js";
import { readOnlyDaemonEffect } from "./effect.js";
import type { ToolResult } from "./index.js";

const approvalTool: KotaTool = {
	name: "approval",
	description:
		"Review queued tool calls that need approval. " +
		"Dangerous tool calls in autonomous contexts are queued instead of denied. " +
		"Agent-visible actions are read-only: list pending items or count them. " +
		"Approve or reject through the operator CLI or authenticated daemon client.",
	input_schema: {
		type: "object" as const,
		properties: {
			action: {
				type: "string",
				enum: ["list", "count"],
				description: "Action to perform",
			},
		},
		required: ["action"],
	},
};

async function runApproval(input: Record<string, unknown>): Promise<ToolResult> {
	const action = input.action as string;
	const queue = getApprovalQueue();

	switch (action) {
		case "count": {
			const pending = queue.count("pending");
			return { content: `${pending} pending approval(s)` };
		}
		case "list": {
			const items = queue.list("pending");
			if (items.length === 0) return { content: "No pending approvals." };
			const lines = items.map(
				(item) =>
					`- [${item.id}] ${item.tool}(${JSON.stringify(item.input).slice(0, 80)}) — ${item.risk}: ${item.reason}`,
			);
			return { content: `${items.length} pending:\n${lines.join("\n")}` };
		}
		default:
			return {
				content: `Unknown action: ${action}. Use list or count. Approve and reject through the operator approval surfaces.`,
				is_error: true,
			};
	}
}

export const registration = {
	tool: approvalTool,
	runner: runApproval,
	effect: readOnlyDaemonEffect(),
	group: "management",
};
