import { describe, expect, it, vi } from "vitest";
import type {
	KotaToolResultBlock,
	KotaToolUseBlock,
} from "#core/agent-harness/message-protocol.js";
import {
	confirmActionMock,
	deferred,
	executeToolMock,
	getAllToolsMock,
	getToolEffectMock,
	openaiToolsAgentHarness,
	queueEnd,
	queueToolUse,
	queueToolUseBlocks,
	streamCallSnapshots,
	tool,
	WRITE_EFFECT,
} from "./adapter-shared-runner-test-support.js";

describe("openaiToolsAgentHarness shared runner", () => {
	it("enforces explicit guardrails config through the shared runner", async () => {
		getAllToolsMock.mockReturnValue([tool("shell")]);
		queueToolUse("call_config_guardrail", "shell", { command: "rm -rf ./tmp" });
		queueEnd("ran with guardrails");
		executeToolMock.mockResolvedValue({ content: "executed" });
		confirmActionMock.mockResolvedValue(true);

		await openaiToolsAgentHarness.run({
			prompt: "delete temp files",
			model: "openai/gpt-5.4-mini",
			effort: "xhigh",
			guardrailsConfig: {
				policies: { safe: "allow", moderate: "allow", dangerous: "confirm" },
			},
		});

		expect(confirmActionMock).toHaveBeenCalledWith(
			expect.stringContaining("Allow shell?"),
		);
		expect(executeToolMock).toHaveBeenCalledWith(
			"shell",
			{ command: "rm -rf ./tmp" },
			expect.objectContaining({ toolUseId: "call_config_guardrail" }),
		);
		const result = streamCallSnapshots[1].messages[2].content as KotaToolResultBlock[];
		expect(result[0]).toMatchObject({
			tool_use_id: "call_config_guardrail",
			content: "executed",
			is_error: false,
		});
	});

	it("inherits the default guardrails policy through the shared runner", async () => {
		getAllToolsMock.mockReturnValue([tool("shell")]);
		queueToolUse("call_default_guardrail", "shell", { command: "rm -rf ./tmp" });
		queueEnd("ran with default guardrails");
		executeToolMock.mockResolvedValue({ content: "executed" });
		confirmActionMock.mockResolvedValue(true);

		await openaiToolsAgentHarness.run({
			prompt: "delete temp files",
			model: "openai/gpt-5.4-mini",
			effort: "xhigh",
		});

		expect(confirmActionMock).toHaveBeenCalledWith(
			expect.stringContaining("Allow shell?"),
		);
		expect(executeToolMock).toHaveBeenCalledWith(
			"shell",
			{ command: "rm -rf ./tmp" },
			expect.objectContaining({ toolUseId: "call_default_guardrail" }),
		);
		const result = streamCallSnapshots[1].messages[2].content as KotaToolResultBlock[];
		expect(result[0]).toMatchObject({
			tool_use_id: "call_default_guardrail",
			content: "executed",
			is_error: false,
		});
	});

	it("queues non-safe tool calls in supervised mode through the approval queue", async () => {
		getAllToolsMock.mockReturnValue([tool("shell")]);
		getToolEffectMock.mockReturnValue(WRITE_EFFECT);
		queueToolUse("call_supervised", "shell", { command: "touch x" });
		queueEnd("queued");

		await openaiToolsAgentHarness.run({
			prompt: "run a command",
			model: "openai/gpt-5.4-mini",
			effort: "xhigh",
			autonomyMode: "supervised",
			workflowContext: {
				workflowName: "wf",
				runId: "run-1",
				stepId: "step-1",
				spanId: "run-1:step-1",
				scopeId: "scope-a",
				projectId: "scope-a",
			},
		});

		expect(executeToolMock).not.toHaveBeenCalled();
		const result = streamCallSnapshots[1].messages[2].content as KotaToolResultBlock[];
		expect(result[0].content).toContain("Queued for approval");
	});

	it("enforces guardrail deny policy through the shared runner", async () => {
		getAllToolsMock.mockReturnValue([tool("echo_tool")]);
		queueToolUse("call_guardrail_deny", "echo_tool", { text: "blocked" });
		queueEnd("blocked");

		await openaiToolsAgentHarness.run({
			prompt: "deny",
			model: "openai/gpt-5.4-mini",
			effort: "xhigh",
			guardrailsConfig: {
				policies: { safe: "allow", moderate: "allow", dangerous: "allow" },
				toolOverrides: { echo_tool: "deny" },
			},
		});

		expect(executeToolMock).not.toHaveBeenCalled();
		const result = streamCallSnapshots[1].messages[2].content as KotaToolResultBlock[];
		expect(result[0]).toMatchObject({
			tool_use_id: "call_guardrail_deny",
			is_error: true,
		});
		expect(result[0].content).toContain("Blocked by guardrails");
	});

	it("injects core failure guidance after repeated identical tool failures", async () => {
		getAllToolsMock.mockReturnValue([tool("unstable_tool")]);
		queueToolUse("fail_1", "unstable_tool", {});
		queueToolUse("fail_2", "unstable_tool", {});
		queueToolUse("fail_3", "unstable_tool", {});
		queueEnd("explained");
		executeToolMock.mockResolvedValue({
			content: "transient backend failure",
			is_error: true,
		});

		await openaiToolsAgentHarness.run({
			prompt: "try the tool",
			model: "openai/gpt-5.4-mini",
			effort: "xhigh",
		});

		const fourthTurnMessages = streamCallSnapshots[3].messages;
		expect(fourthTurnMessages[fourthTurnMessages.length - 1]).toEqual({
			role: "user",
			content:
				"You have failed the same way 3 times in a row. Stop and explain what's going wrong.",
		});
	});

	it("runs read-only tool batches concurrently while preserving result order", async () => {
		getAllToolsMock.mockReturnValue([tool("read_slow"), tool("read_fast")]);
		const blocks: KotaToolUseBlock[] = [
			{ type: "tool_use", id: "call_slow", name: "read_slow", input: {} },
			{ type: "tool_use", id: "call_fast", name: "read_fast", input: {} },
		];
		queueToolUseBlocks("msg_parallel", blocks);
		queueEnd();
		const slow = deferred<string>();
		const fast = deferred<string>();
		const started: string[] = [];
		executeToolMock.mockImplementation(async (name: string) => {
			started.push(name);
			if (name === "read_slow") return { content: await slow.promise };
			if (name === "read_fast") return { content: await fast.promise };
			throw new Error(`unexpected tool ${name}`);
		});

		const run = openaiToolsAgentHarness.run({
			prompt: "read both",
			model: "openai/gpt-5.4-mini",
			effort: "xhigh",
		});
		await vi.waitFor(() => expect(started).toEqual(["read_slow", "read_fast"]));
		fast.resolve("fast-result");
		slow.resolve("slow-result");
		await run;

		const results = streamCallSnapshots[1].messages[2].content as KotaToolResultBlock[];
		expect(results.map((result) => result.tool_use_id)).toEqual([
			"call_slow",
			"call_fast",
		]);
		expect(results.map((result) => result.content)).toEqual([
			"slow-result",
			"fast-result",
		]);
	});
});
