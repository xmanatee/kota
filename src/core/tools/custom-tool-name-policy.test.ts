import { beforeEach, describe, expect, it } from "vitest";
import { resetCustomTools, runCustomTool } from "./custom-tool.js";

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
});
