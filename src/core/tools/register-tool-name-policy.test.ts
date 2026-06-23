import { afterEach, describe, expect, it } from "vitest";
import { clearCustomTools, registerTool } from "./index.js";

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
});
