import { describe, expect, it } from "vitest";
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
});
