/**
 * Approval tool — review and resolve queued tool calls requiring human approval.
 *
 * When guardrails queue a tool call (dangerous operations in autonomous contexts),
 * this tool lets the agent or user list, approve, or reject pending items.
 * Approved items are executed immediately and the result returned.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { getApprovalQueue } from "../approval-queue.js";
import { executeTool, type ToolResult } from "./index.js";

const approvalTool: Anthropic.Tool = {
	name: "approval",
	description:
		"Review and resolve queued tool calls that need approval. " +
		"Dangerous tool calls in autonomous contexts are queued instead of denied. " +
		"Actions: list (pending items), approve (execute queued call), reject, count.",
	input_schema: {
		type: "object" as const,
		properties: {
			action: {
				type: "string",
				enum: ["list", "approve", "reject", "count"],
				description: "Action to perform",
			},
			id: {
				type: "string",
				description: "Approval ID (required for approve/reject)",
			},
			reason: {
				type: "string",
				description: "Reason for rejection (optional, for reject action)",
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
		case "approve": {
			const id = input.id as string;
			if (!id) return { content: "Error: id is required for approve", is_error: true };
			const item = queue.approve(id);
			if (!item)
				return { content: `Error: approval ${id} not found or already resolved`, is_error: true };
			const result = await executeTool(item.tool, item.input);
			return {
				content: `Approved and executed ${item.tool}:\n${result.content}`,
				is_error: result.is_error,
			};
		}
		case "reject": {
			const id = input.id as string;
			if (!id) return { content: "Error: id is required for reject", is_error: true };
			const reason = (input.reason as string) || undefined;
			const item = queue.reject(id, reason);
			if (!item)
				return { content: `Error: approval ${id} not found or already resolved`, is_error: true };
			return { content: `Rejected: ${item.tool} [${id}]${reason ? ` — ${reason}` : ""}` };
		}
		default:
			return {
				content: `Unknown action: ${action}. Use list, approve, reject, or count.`,
				is_error: true,
			};
	}
}

export const registration = {
	tool: approvalTool,
	runner: runApproval,
	risk: "safe" as const,
	group: "management",
};
