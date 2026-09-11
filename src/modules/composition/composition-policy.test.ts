import { afterEach, beforeEach, expect, it } from "vitest";
import { localWriteEffect, readOnlyLocalEffect } from "#core/tools/effect.js";
import { deregisterTool, registerTool } from "#core/tools/index.js";
import { executeToolCalls } from "#core/tools/tool-runner-execution.js";
import { mapTool, runMap } from "./map.js";
import { pipeTool, runPipe } from "./pipe.js";

let effects = 0;
beforeEach(() => {
	effects = 0;
	for (const [tool, runner] of [
		[mapTool, runMap],
		[pipeTool, runPipe],
	] as const) {
		registerTool(tool, runner, undefined, { effect: localWriteEffect() });
	}
	registerTool(
		{
			name: "child_read",
			description: "Controlled resource reader",
			input_schema: { type: "object", properties: {} },
		},
		async (_input, context) => {
			effects++;
			return { content: `Read for ${context?.sessionId}` };
		},
		undefined,
		{ effect: readOnlyLocalEffect() },
	);
});
afterEach(() => {
	for (const name of ["map", "pipe", "child_read"]) deregisterTool(name);
});

it.each([
	{ name: "map", input: { tool: "child_read", items: [{}] } },
	{ name: "pipe", input: { steps: [{ tool: "child_read", input: {} }] } },
])("$name preserves child permissions and session identity", async ({
	name,
	input,
}) => {
	const call = { type: "tool_use" as const, id: "outer", name, input };
	const options = {
		resultLimit: 10_000,
		verbose: false,
		autonomyMode: "autonomous" as const,
		sessionId: "session-A",
	};
	const [denied] = await executeToolCalls([call], {
		...options,
		disallowedTools: ["child_read"],
	});
	expect(denied.content).toContain("disallowedTools");
	expect(effects).toBe(0);
	const [permissionDenied] = await executeToolCalls([call], {
		...options,
		canUseTool: async (tool) =>
			tool === "child_read"
				? { behavior: "deny", message: "Private resource" }
				: { behavior: "allow" },
	});
	expect(permissionDenied.content).toContain("Private resource");
	expect(effects).toBe(0);
	const [allowed] = await executeToolCalls([call], options);
	expect(allowed.content).toContain("Read for session-A");
	expect(effects).toBe(1);
});

it("returns fresh results when different sessions compose the same child call", async () => {
	const call = {
		type: "tool_use" as const,
		id: "map",
		name: "map",
		input: { tool: "child_read", items: [{}] },
	};
	for (const sessionId of ["session-A", "session-B"]) {
		const [result] = await executeToolCalls([call], {
			resultLimit: 10000,
			verbose: false,
			autonomyMode: "autonomous",
			sessionId,
		});
		expect(result.content).toContain(`Read for ${sessionId}`);
	}
	expect(effects).toBe(2);
});
