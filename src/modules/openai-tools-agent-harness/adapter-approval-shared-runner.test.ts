import { describe, expect, it, vi } from "vitest";
import type { KotaToolResultBlock } from "#core/agent-harness/message-protocol.js";
import {
	confirmActionMock,
	enqueueApprovalMock,
	executeToolMock,
	openaiToolsAgentHarness,
	queueEnd,
	queueToolUse,
	streamCallSnapshots,
} from "./adapter-shared-runner-test-support.js";

describe("openaiToolsAgentHarness shared runner approval paths", () => {
	it("runs guardrail confirm before executing a confirmed tool", async () => {
		queueToolUse("confirm_1", "echo_tool", { text: "deploy" });
		queueEnd("confirmed");
		confirmActionMock.mockResolvedValue(true);
		executeToolMock.mockResolvedValue({ content: "executed after confirm" });

		const result = await openaiToolsAgentHarness.run({
			prompt: "go",
			model: "openai/gpt-5.6-luna",
			effort: "xhigh",
			guardrailsConfig: {
				policies: { safe: "allow", moderate: "allow", dangerous: "allow" },
				toolOverrides: { echo_tool: "confirm" },
			},
		});

		expect(confirmActionMock).toHaveBeenCalledWith(
			expect.stringContaining("Allow echo_tool?"),
		);
		expect(executeToolMock).toHaveBeenCalledWith(
			"echo_tool",
			{ text: "deploy" },
			expect.objectContaining({ toolUseId: "confirm_1" }),
		);
		const followupBlocks = streamCallSnapshots[1].messages[2].content as KotaToolResultBlock[];
		expect(followupBlocks[0]).toMatchObject({
			type: "tool_result",
			tool_use_id: "confirm_1",
			content: "executed after confirm",
			is_error: false,
		});
		expect(result.isError).toBe(false);
	});

	it("queues a guardrail queue-policy tool through the approval queue", async () => {
		queueToolUse("queue_1", "echo_tool", { text: "needs approval" });
		queueEnd("queued");
		const defaultEnqueue = enqueueApprovalMock.getMockImplementation();
		if (!defaultEnqueue) throw new Error("missing default approval enqueue mock");
		enqueueApprovalMock.mockImplementation((...args) => ({
			...defaultEnqueue(...args),
			id: "approval-queue-path",
		}));

		const result = await openaiToolsAgentHarness.run({
			prompt: "go",
			model: "openai/gpt-5.6-luna",
			effort: "xhigh",
			guardrailsConfig: {
				policies: { safe: "allow", moderate: "allow", dangerous: "allow" },
				toolOverrides: { echo_tool: "queue" },
			},
		});

		expect(enqueueApprovalMock).toHaveBeenCalledTimes(1);
		expect(executeToolMock).not.toHaveBeenCalled();
		const followupBlocks = streamCallSnapshots[1].messages[2].content as KotaToolResultBlock[];
		expect(followupBlocks[0]).toMatchObject({
			type: "tool_result",
			tool_use_id: "queue_1",
			is_error: true,
		});
		expect(followupBlocks[0].content).toContain("Queued for approval");
		expect(followupBlocks[0].content).toContain("approval-queue-path");
		expect(result.isError).toBe(false);
	});

	it("uses client approval instead of enqueueing for an allowed queue-policy tool", async () => {
		queueToolUse("client_approval_1", "echo_tool", { text: "ship" });
		queueEnd("client approved");
		executeToolMock.mockResolvedValue({ content: "executed after client approval" });
		const clientApprovalResolver = vi.fn().mockResolvedValue({ outcome: "allow" });

		const result = await openaiToolsAgentHarness.run({
			prompt: "go",
			model: "openai/gpt-5.6-luna",
			effort: "xhigh",
			guardrailsConfig: {
				policies: { safe: "allow", moderate: "allow", dangerous: "allow" },
				toolOverrides: { echo_tool: "queue" },
			},
			clientApprovalResolver,
		});

		expect(clientApprovalResolver).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "client_approval_1",
				toolUseId: "client_approval_1",
				toolName: "echo_tool",
				input: { text: "ship" },
			}),
		);
		expect(enqueueApprovalMock).not.toHaveBeenCalled();
		expect(executeToolMock).toHaveBeenCalledWith(
			"echo_tool",
			{ text: "ship" },
			expect.objectContaining({ toolUseId: "client_approval_1" }),
		);
		const followupBlocks = streamCallSnapshots[1].messages[2].content as KotaToolResultBlock[];
		expect(followupBlocks[0]).toMatchObject({
			type: "tool_result",
			tool_use_id: "client_approval_1",
			content: "executed after client approval",
			is_error: false,
		});
		expect(result.isError).toBe(false);
	});
});
