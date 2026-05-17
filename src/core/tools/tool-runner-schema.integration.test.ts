import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearCustomTools, registerTool } from "./index.js";
import { executeToolCalls } from "./tool-runner.js";
import { getToolTelemetry, resetToolTelemetry } from "./tool-telemetry.js";

const outputSchema = {
	type: "object" as const,
	properties: {
		ok: { type: "boolean" },
		count: { type: "number" },
	},
	required: ["ok", "count"],
	additionalProperties: false,
};

function registerStructuredTool(
	name: string,
	runner: Parameters<typeof registerTool>[1],
): void {
	registerTool(
		{
			name,
			description: `Structured test tool ${name}`,
			input_schema: { type: "object", properties: {} },
			output_schema: outputSchema,
		},
		runner,
	);
}

describe("executeToolCalls output_schema enforcement", () => {
	beforeEach(() => {
		resetToolTelemetry();
	});

	afterEach(() => {
		clearCustomTools();
	});

	it("records valid structured local results as successful telemetry", async () => {
		registerStructuredTool("structured_runner_valid", async () => ({
			content: "valid",
			structuredContent: { ok: true, count: 1 },
		}));

		const results = await executeToolCalls(
			[
				{
					type: "tool_use",
					id: "valid-1",
					name: "structured_runner_valid",
					input: {},
				},
			],
			{
				resultLimit: 50000,
				verbose: false,
				autonomyMode: "autonomous",
			},
		);

		expect(results[0]).toMatchObject({
			tool_use_id: "valid-1",
			content: "valid",
			structuredContent: { ok: true, count: 1 },
		});
		expect(results[0].is_error).toBeUndefined();
		expect(getToolTelemetry().getCallRecords()[0]).toMatchObject({
			toolUseId: "valid-1",
			tool: "structured_runner_valid",
			success: true,
			resultContentKind: "structured",
		});
	});

	it("records schema-invalid local structured results as failed telemetry", async () => {
		registerStructuredTool("structured_runner_invalid", async () => ({
			content: "invalid",
			structuredContent: { ok: true, count: "two" },
		}));

		const results = await executeToolCalls(
			[
				{
					type: "tool_use",
					id: "invalid-1",
					name: "structured_runner_invalid",
					input: {},
				},
			],
			{
				resultLimit: 50000,
				verbose: false,
				autonomyMode: "autonomous",
			},
		);

		expect(results[0].tool_use_id).toBe("invalid-1");
		expect(results[0].is_error).toBe(true);
		expect(results[0].content).toContain("structuredContent does not match output_schema");
		expect(results[0].structuredContent).toBeUndefined();
		expect(getToolTelemetry().getCallRecords()[0]).toMatchObject({
			toolUseId: "invalid-1",
			tool: "structured_runner_invalid",
			success: false,
			resultContentKind: "text",
		});
	});
});
