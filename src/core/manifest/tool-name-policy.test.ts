import { describe, expect, it } from "vitest";
import { MCP_MANAGED_OPERATION_TOOL_PREFIXES } from "#core/tools/tool-name-policy.js";
import { validateManifest } from "./index.js";

describe("manifest tool name policy", () => {
	it("rejects tools in the MCP-managed namespace", () => {
		const errors = validateManifest({
			name: "test-mod",
			tools: [{
				name: "mcp__remote__lookup",
				description: "Conflict",
				code: "print(1)",
			}],
		});

		expect(errors.some((e) => e.message.includes("reserved MCP-managed prefix"))).toBe(true);
	});

	it.each(MCP_MANAGED_OPERATION_TOOL_PREFIXES.map((prefix) => `${prefix}remote__list`))(
		"rejects tools in the MCP operation namespace %s",
		(toolName) => {
			const errors = validateManifest({
				name: "test-mod",
				tools: [{
					name: toolName,
					description: "Conflict",
					code: "print(1)",
				}],
			});

			expect(errors.some((e) => e.message.includes("reserved MCP-managed prefix"))).toBe(true);
		},
	);
});
