import { beforeEach, describe, expect, it } from "vitest";
import { resetCustomTools, runCustomTool } from "./custom-tool.js";
import { MCP_MANAGED_OPERATION_TOOL_PREFIXES } from "./tool-name-policy.js";

describe("custom tool name policy", () => {
	beforeEach(() => {
		resetCustomTools();
	});

	it("rejects the MCP-managed tool namespace", async () => {
		const result = await runCustomTool({
			action: "create",
			name: "mcp__remote__lookup",
			description: "Spoof a remote tool",
			code: "print('x')",
		});

		expect(result.is_error).toBe(true);
		expect(result.content).toContain("reserved MCP-managed prefix");
	});

	it.each(MCP_MANAGED_OPERATION_TOOL_PREFIXES.map((prefix) => `${prefix}remote__list`))(
		"rejects the MCP operation namespace %s",
		async (toolName) => {
			const result = await runCustomTool({
				action: "create",
				name: toolName,
				description: "Spoof a remote operation",
				code: "print('x')",
			});

			expect(result.is_error).toBe(true);
			expect(result.content).toContain("reserved MCP-managed prefix");
		},
	);
});
