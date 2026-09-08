import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

	it("validates final tool input against the registered schema before approval queueing", async () => {
		const runner = vi.fn(async () => ({ content: "should not execute while queued" }));
		registerTool(
			{
				name: "validated_deploy",
				description: "Deploy a validated target",
				input_schema: {
					type: "object",
					properties: {
						command: { type: "string" },
						cwd: { type: "string" },
					},
					required: ["command", "cwd"],
					additionalProperties: false,
				},
			},
			runner,
		);
		const enqueue = vi.fn(() => ({ id: "approval-validated" }));
		const approvalQueue = { enqueue } as never;

		const invalid = await executeToolCalls(
			[{
				type: "tool_use",
				id: "invalid-input",
				name: "validated_deploy",
				input: { command: "deploy", hiddenPath: "/srv/unreviewed" },
			}],
			{
				resultLimit: 50000,
				verbose: false,
				autonomyMode: "supervised",
				approvalQueue,
			},
		);

		expect(invalid[0]).toMatchObject({
			is_error: true,
			content: expect.stringContaining('missing required field "cwd"'),
		});
		expect(enqueue).not.toHaveBeenCalled();
		expect(runner).not.toHaveBeenCalled();

		const invalidRewrite = await executeToolCalls(
			[{
				type: "tool_use",
				id: "invalid-rewrite",
				name: "validated_deploy",
				input: { command: "deploy", cwd: "/srv/reviewed" },
			}],
			{
				resultLimit: 50000,
				verbose: false,
				autonomyMode: "supervised",
				approvalQueue,
				canUseTool: async () => ({
					behavior: "allow",
					updatedInput: {
						command: "deploy",
						cwd: "/srv/reviewed",
						hiddenPath: "/srv/unreviewed",
					},
				}),
			},
		);

		expect(invalidRewrite[0]).toMatchObject({
			is_error: true,
			content: expect.stringContaining('unexpected field "hiddenPath"'),
		});
		expect(enqueue).not.toHaveBeenCalled();
		expect(runner).not.toHaveBeenCalled();

		const validatedInput = { command: "deploy", cwd: "/srv/reviewed" };
		const valid = await executeToolCalls(
			[{
				type: "tool_use",
				id: "valid-input",
				name: "validated_deploy",
				input: validatedInput,
			}],
			{
				resultLimit: 50000,
				verbose: false,
				autonomyMode: "supervised",
				approvalQueue,
			},
		);

		expect(valid[0].content).toContain("Queued for approval [approval-validated]");
		expect(enqueue).toHaveBeenCalledWith(
			"validated_deploy",
			validatedInput,
			"moderate",
			expect.stringContaining('autonomy mode "supervised"'),
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
		);
		expect(runner).not.toHaveBeenCalled();
	});

	it("rejects non-JSON object instances before permission hooks or execution", async () => {
		const runner = vi.fn(async () => ({ content: "must not execute" }));
		registerTool(
			{
				name: "json_only_input",
				description: "Accept JSON-compatible objects only",
				input_schema: { type: "object", properties: {} },
			},
			runner,
		);
		const canUseTool = vi.fn(async () => ({ behavior: "allow" as const }));

		const result = await executeToolCalls(
			[{
				type: "tool_use",
				id: "non-json-input",
				name: "json_only_input",
				input: new Date("2026-07-29T00:00:00.000Z") as never,
			}],
			{
				resultLimit: 50000,
				verbose: false,
				autonomyMode: "autonomous",
				canUseTool,
			},
		);

		expect(result[0]).toMatchObject({
			is_error: true,
			content: expect.stringContaining("expected a JSON object"),
		});
		expect(canUseTool).not.toHaveBeenCalled();
		expect(runner).not.toHaveBeenCalled();
	});
});
