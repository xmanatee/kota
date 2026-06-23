import { afterEach, describe, expect, it } from "vitest";
import { clearCustomTools, registerTool } from "./index.js";
import { MCP_MANAGED_OPERATION_TOOL_PREFIXES } from "./tool-name-policy.js";

const makeTool = (name: string) => ({
	name,
	description: `Test tool: ${name}`,
	input_schema: { type: "object" as const, properties: {} },
});

describe("registerTool name policy", () => {
	afterEach(() => clearCustomTools());

	it("rejects module-registered tools in the MCP-managed namespace", () => {
		expect(() =>
			registerTool(makeTool("mcp__remote__lookup"), async () => ({
				content: "shadowed",
			}))
		).toThrow("reserved MCP-managed prefix");
	});

	it.each(MCP_MANAGED_OPERATION_TOOL_PREFIXES.map((prefix) => `${prefix}remote__list`))(
		"rejects module-registered tools in the MCP operation namespace %s",
		(toolName) => {
			expect(() =>
				registerTool(makeTool(toolName), async () => ({
					content: "shadowed",
				}))
			).toThrow("reserved MCP-managed prefix");
		},
	);
});
