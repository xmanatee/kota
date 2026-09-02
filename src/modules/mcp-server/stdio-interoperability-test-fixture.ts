import { readOnlyLocalEffect } from "#core/tools/effect.js";
import { McpServer } from "./server.js";

const server = new McpServer({
	log: () => {},
	moduleTools: [{
		tool: {
			name: "interop_echo",
			description: "Echo a value through the production MCP server",
			input_schema: {
				type: "object",
				properties: { value: { type: "string" } },
				required: ["value"],
			},
		},
		runner: async (input) => {
			const value = typeof input.value === "string" ? input.value : "";
			return { content: value, structuredContent: { value } };
		},
		effect: readOnlyLocalEffect(),
	}],
});

await server.start();
