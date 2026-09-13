import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import { jsonRpcHttpResponse, mockClientHttpFetch } from "#core/mcp/client-http-test-helpers.js";
import { MCP_CURRENT_PROTOCOL_VERSION, MCP_STATELESS_PROTOCOL_VERSION } from "#core/mcp/client-protocol.js";
import { McpManager } from "#core/mcp/manager.js";
import { clearCustomTools, registerTool } from "./index.js";
import { executeToolCalls } from "./tool-runner.js";
import { getToolTelemetry, resetToolTelemetry } from "./tool-telemetry.js";

const outputSchema = {
	type: "object" as const,
	properties: {
		ok: { type: "boolean" },
		count: { type: "integer" },
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
      undefined,
      expect.objectContaining({ declarationEffectFingerprint: expect.any(String) }),
		);
		expect(runner).not.toHaveBeenCalled();
	});

	it("admits integer inputs and nullable integers while rejecting fractions and strings before execution", async () => {
		const runner = vi.fn(async () => ({ content: "executed" }));
		registerTool({
			name: "integer_input",
			description: "Validate numeric input",
			input_schema: {
				type: "object",
				properties: {
					repeatCount: { type: "integer" },
					optionalCount: { type: ["integer", "null"] },
					allocation: { type: "number" },
				},
				required: ["repeatCount", "optionalCount", "allocation"],
			},
		}, runner);
		const invoke = (input: { repeatCount: number | string; optionalCount: number | null; allocation: number }) => executeToolCalls(
			[{ type: "tool_use", id: "integer-input", name: "integer_input", input }],
			{ resultLimit: 50000, verbose: false, autonomyMode: "autonomous" },
		);
		for (const input of [
			{ repeatCount: 3, optionalCount: null, allocation: 1.5 },
			{ repeatCount: 0, optionalCount: -2, allocation: 2 },
		]) {
			const result = await invoke(input);
			expect(result[0]).toMatchObject({ content: "executed" });
			expect(result[0].is_error).toBeUndefined();
		}
		expect(runner).toHaveBeenCalledTimes(2);
		runner.mockClear();
		for (const input of [
			{ repeatCount: 1.5, optionalCount: null, allocation: 1 },
			{ repeatCount: "3", optionalCount: null, allocation: 1 },
			{ repeatCount: 3, optionalCount: 0.5, allocation: 1 },
		]) {
			const result = await invoke(input);
			expect(result[0]).toMatchObject({ is_error: true, content: expect.stringContaining("expected integer") });
		}
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


describe("agent MCP input schema negotiation", () => {
  it.each([MCP_STATELESS_PROTOCOL_VERSION, MCP_CURRENT_PROTOCOL_VERSION])(
    "validates initial and rewritten arguments using the negotiated %s contract",
    async (protocolVersion) => {
      const released = protocolVersion === MCP_STATELESS_PROTOCOL_VERSION;
      const calls: KotaJsonObject[] = [];
      const fetch = mockClientHttpFetch(({body, headers}) => {
        if (body.method === "server/discover") {
          if (headers.get("MCP-Protocol-Version") !== protocolVersion) {
            return new Response(JSON.stringify({jsonrpc: "2.0", id: body.id, error: {
              code: -32022, message: "Unsupported protocol version",
              data: {requested: MCP_STATELESS_PROTOCOL_VERSION, supported: [protocolVersion]},
            }}), {status: 400, headers: {"content-type": "application/json"}});
          }
          return jsonRpcHttpResponse(body.id, {
            ...(released ? {resultType: "complete", ttlMs: 0, cacheScope: "private",
              _meta: {"io.modelcontextprotocol/serverInfo": {name: "schema-peer", version: "1"}}}
              : {serverInfo: {name: "schema-peer"}}),
            supportedVersions: [protocolVersion], capabilities: {tools: {}},
          });
        }
        if (body.method === "tools/list") return jsonRpcHttpResponse(body.id, {
          resultType: "complete", ttlMs: 0, cacheScope: "private", tools: [{
            name: "echo", annotations: {readOnlyHint: true}, inputSchema: {
              type: "object", properties: {fixed: {type: "string"}},
              patternProperties: {"^x": {type: "string"}}, additionalProperties: false,
            },
          }],
        });
        expect(body.method).toBe("tools/call");
        if (!body.params) throw new Error("Missing call parameters");
        calls.push(body.params.arguments);
        return jsonRpcHttpResponse(body.id, {
          resultType: "complete", content: [{type: "text", text: JSON.stringify(body.params.arguments)}],
        });
      });
      const manager = new McpManager();
      try {
        await manager.initialize({mcpServers: {schema: {type: "http", url: "https://schema.example.test/mcp"}}});
        const [tool] = manager.getTools();
        expect(tool).toBeDefined();
        const canUseTool = vi.fn(async () => ({behavior: "allow" as const}));
        const invoke = (input: KotaJsonObject, updatedInput?: KotaJsonObject) => executeToolCalls(
          [{type: "tool_use", id: "schema-call", name: tool.name, input}],
          {resultLimit: 50000, verbose: false, autonomyMode: "autonomous", mcpManager: manager,
            canUseTool: updatedInput === undefined ? canUseTool : async () => ({behavior: "allow", updatedInput})},
        );
        const valid: KotaJsonObject = released ? {x: "valid"} : {fixed: "valid"};
        expect((await invoke(valid))[0]).toMatchObject({content: JSON.stringify(valid)});
        expect(calls).toEqual([valid]);
        canUseTool.mockClear();
        const invalidInputs: KotaJsonObject[] = [{x: 42}, {unexpected: "invalid"}];
        for (const invalid of invalidInputs) {
          expect((await invoke(invalid))[0].is_error).toBe(true);
        }
        expect(canUseTool).not.toHaveBeenCalled();
        expect((await invoke(valid, {x: 42}))[0].is_error).toBe(true);
        expect(calls).toHaveLength(1);
        const rewritten: KotaJsonObject = released ? {x: "rewritten"} : {fixed: "rewritten"};
        expect((await invoke(valid, rewritten))[0]).toMatchObject({content: JSON.stringify(rewritten)});
        expect(calls).toEqual([valid, rewritten]);
        if (!released) {
          expect((await invoke({x: "valid"}))[0]).toMatchObject({
            is_error: true, content: expect.stringContaining('unexpected field "x"'),
          });
          expect(calls).toHaveLength(2);
        }
      } finally {
        await manager.close();
        fetch.mockRestore();
      }
    },
  );
});
