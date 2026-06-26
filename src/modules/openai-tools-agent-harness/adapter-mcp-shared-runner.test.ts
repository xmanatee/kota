import { describe, expect, it, vi } from "vitest";
import type { KotaToolResultBlock } from "#core/agent-harness/message-protocol.js";
import { McpManager } from "#core/mcp/manager.js";
import {
	executeToolMock,
	getAllToolsMock,
	mcpFixtureServer,
	openaiToolsAgentHarness,
	queueEnd,
	queueToolUse,
	streamCallSnapshots,
	tool,
} from "./adapter-shared-runner-test-support.js";

describe("openaiToolsAgentHarness MCP shared runner", () => {
	it("routes MCP tool calls through a KOTA-owned McpManager", async () => {
		queueToolUse("call_mcp", "mcp__remote__lookup", { q: "hello" });
		queueEnd();

		await openaiToolsAgentHarness.run({
			prompt: "call mcp",
			model: "openai/gpt-5.4-mini",
			effort: "xhigh",
			mcpServers: {
				remote: {
					type: "stdio",
					command: process.execPath,
					args: ["-e", mcpFixtureServer()],
				},
			},
		});

		expect(executeToolMock).not.toHaveBeenCalled();
		expect(streamCallSnapshots[0].tools?.map((entry) => entry.name)).toContain(
			"mcp__remote__lookup",
		);
		expect(streamCallSnapshots[1].messages[2]).toEqual({
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "call_mcp",
					content: [{ type: "text", text: "remote content" }],
					is_error: false,
				},
			] satisfies KotaToolResultBlock[],
		});
	});

	it("refreshes MCP tool declarations and fingerprints before each model turn", async () => {
		getAllToolsMock.mockReturnValue([tool("echo_tool")]);
		queueToolUse("call_local", "echo_tool", { text: "hello" });
		queueEnd();
		executeToolMock.mockResolvedValue({ content: "local result" });
		const firstMcpTool = tool("mcp__remote__lookup_v1");
		const secondMcpTool = tool("mcp__remote__lookup_v2");
		const getToolsSpy = vi
			.spyOn(McpManager.prototype, "getTools")
			.mockReturnValueOnce([firstMcpTool])
			.mockReturnValueOnce([secondMcpTool]);
		const fingerprintSpy = vi
			.spyOn(McpManager.prototype, "getToolDeclarationFingerprint")
			.mockImplementation((name: string) => `fp:${name}`);

		try {
			await openaiToolsAgentHarness.run({
				prompt: "refresh mcp",
				model: "openai/gpt-5.4-mini",
				effort: "xhigh",
				mcpServers: {
					remote: {
						type: "stdio",
						command: process.execPath,
						args: ["-e", mcpFixtureServer()],
					},
				},
			});
			expect(streamCallSnapshots[0].tools?.map((entry) => entry.name)).toEqual([
				"echo_tool",
				"mcp__remote__lookup_v1",
			]);
			expect(streamCallSnapshots[1].tools?.map((entry) => entry.name)).toEqual([
				"echo_tool",
				"mcp__remote__lookup_v2",
			]);
			expect(fingerprintSpy).toHaveBeenCalledWith("mcp__remote__lookup_v1");
			expect(fingerprintSpy).toHaveBeenCalledWith("mcp__remote__lookup_v2");
		} finally {
			getToolsSpy.mockRestore();
			fingerprintSpy.mockRestore();
		}
	});
});
