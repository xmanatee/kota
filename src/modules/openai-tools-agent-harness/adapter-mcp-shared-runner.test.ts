import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { clearAgentHarnessRegistryForTest, registerAgentHarness, runAgentHarness } from "#core/agent-harness/index.js";
import type { KotaModelResponse, KotaToolResultBlock } from "#core/agent-harness/message-protocol.js";
import { McpManager } from "#core/mcp/manager.js";
import * as mcpPorts from "#core/mcp/manager-client-port.js";
import { FakeMcpManagerClient } from "#core/mcp/manager-test-support.js";
import type { MessageStreamParams } from "#core/model/model-client.js";
import {
	createModelClientMock,
	deferred,
	fixtureRunnerMock,
	makeStubStream,
	mcpFixtureServer,
	openaiToolsAgentHarness,
	queueEnd,
	queueToolUse,
	registerFixtureTools,
	streamCallSnapshots,
	tool,
} from "./adapter-shared-runner-test-support.js";

describe("openaiToolsAgentHarness MCP shared runner", () => {
	it("does not execute planted project MCP config when discovery is disabled", async () => {
		const scopeRoot = mkdtempSync(join(tmpdir(), "openai-tools-mcp-disabled-"));
		const executionMarker = join(scopeRoot, "planted-mcp-executed.txt");
		mkdirSync(join(scopeRoot, ".kota"));
		writeFileSync(
			join(scopeRoot, ".kota", "mcp.json"),
			JSON.stringify({
				mcpServers: {
					planted: {
						type: "stdio",
						command: process.execPath,
						args: [
							"-e",
							`require("node:fs").writeFileSync(${JSON.stringify(executionMarker)}, "executed")`,
						],
					},
				},
			}),
			"utf8",
		);
		queueEnd();

		try {
			await openaiToolsAgentHarness.run({
				prompt: "review a merge conflict",
				model: "openai/gpt-5.6-luna",
				effort: "xhigh",
				cwd: scopeRoot,
				mcpScopeConfigPolicy: "disabled",
			});
			expect(existsSync(executionMarker)).toBe(false);
		} finally {
			rmSync(scopeRoot, { recursive: true, force: true });
		}
	});

	it("routes MCP tool calls through a KOTA-owned McpManager", async () => {
		queueToolUse("call_mcp", "mcp__remote__lookup", { q: "hello" });
		queueEnd();

		await openaiToolsAgentHarness.run({
			prompt: "call mcp",
			model: "openai/gpt-5.6-luna",
			effort: "xhigh",
			mcpServers: {
				remote: {
					type: "stdio",
					command: process.execPath,
					args: ["-e", mcpFixtureServer()],
				},
			},
		});

		expect(fixtureRunnerMock).not.toHaveBeenCalled();
		expect(streamCallSnapshots[0].tools?.map((entry) => entry.name)).toContain(
			"mcp__remote__lookup",
		);
		expect(streamCallSnapshots[1].messages[2]).toEqual({
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "call_mcp",
					content: [{ type: "text", text: "remote content" }],
					is_error: false,
				},
			] satisfies KotaToolResultBlock[],
		});
	});

	it("refreshes MCP tool declarations and fingerprints before each model turn", async () => {
		registerFixtureTools([tool("echo_tool")]);
		queueToolUse("call_local", "echo_tool", { text: "hello" });
		queueEnd();
		fixtureRunnerMock.mockResolvedValue({ content: "local result" });
		const firstMcpTool = tool("mcp__remote__lookup_v1");
		const secondMcpTool = tool("mcp__remote__lookup_v2");
		const getToolsSpy = vi
			.spyOn(McpManager.prototype, "getTools")
			.mockReturnValueOnce([firstMcpTool])
			.mockReturnValueOnce([secondMcpTool]);
		const fingerprintSpy = vi
			.spyOn(McpManager.prototype, "getToolDeclarationFingerprint")
			.mockImplementation((name: string) => `fp:${name}`);

		try {
			await openaiToolsAgentHarness.run({
				prompt: "refresh mcp",
				model: "openai/gpt-5.6-luna",
				effort: "xhigh",
				mcpServers: {
					remote: {
						type: "stdio",
						command: process.execPath,
						args: ["-e", mcpFixtureServer()],
					},
				},
			});
			expect(streamCallSnapshots[0].tools?.map((entry) => entry.name)).toEqual(expect.arrayContaining([
				"echo_tool",
				"mcp__remote__lookup_v1",
			]));
			expect(streamCallSnapshots[1].tools?.map((entry) => entry.name)).toEqual(expect.arrayContaining([
				"echo_tool",
				"mcp__remote__lookup_v2",
			]));
			expect(fingerprintSpy).toHaveBeenCalledWith("mcp__remote__lookup_v1");
			expect(fingerprintSpy).toHaveBeenCalledWith("mcp__remote__lookup_v2");
		} finally {
			getToolsSpy.mockRestore();
			fingerprintSpy.mockRestore();
		}
	});

	it("rejects a resumed session when an MCP declaration fingerprint changes", async () => {
		const scopeRoot = mkdtempSync(join(tmpdir(), "openai-tools-mcp-resume-"));
		let fingerprint = "fp:initial";
		const fingerprintSpy = vi
			.spyOn(McpManager.prototype, "getToolDeclarationFingerprint")
			.mockImplementation(() => fingerprint);
		try {
			queueEnd("saved");
			const persisted = await openaiToolsAgentHarness.run({
				prompt: "save mcp state",
				model: "openai/gpt-5.6-luna",
				effort: "xhigh",
				cwd: scopeRoot,
				persistSession: true,
				mcpServers: {
					remote: {
						type: "stdio",
						command: process.execPath,
						args: ["-e", mcpFixtureServer()],
					},
				},
			});

			fingerprint = "fp:changed";
			await expect(
				openaiToolsAgentHarness.run({
					prompt: "resume",
					model: "openai/gpt-5.6-luna",
					effort: "xhigh",
					cwd: scopeRoot,
					resumeSessionId: persisted.sessionId,
					mcpServers: {
						remote: {
							type: "stdio",
							command: process.execPath,
							args: ["-e", mcpFixtureServer()],
						},
					},
				}),
			).rejects.toThrow(/tool declaration for "mcp__remote__lookup" changed/);
		} finally {
			fingerprintSpy.mockRestore();
			rmSync(scopeRoot, { recursive: true, force: true });
		}
	});
});

// Exercises the real hosted adapter, tool runner and nested harness boundary.
it("keeps each hosted invocation's MCP tools through delegation and independent teardown", async () => {
  const roots = { a: mkdtempSync(join(tmpdir(), "hosted-delegate-a-")), b: mkdtempSync(join(tmpdir(), "hosted-delegate-b-")) };
  const requests: Record<string, MessageStreamParams[]> = { a: [], b: [] };
  const clients: Record<string, FakeMcpManagerClient[]> = { a: [], b: [] };
  const startedA = deferred<void>();
  const releaseA = deferred<void>();
  const factory = vi.spyOn(mcpPorts, "createMcpManagerClient").mockImplementation((_transport, name) => {
    if (name !== "a" && name !== "b") throw new Error(`Unexpected MCP server ${name}`);
    const client = new FakeMcpManagerClient(name);
    client.tools = ["lookup", "blocked"].map((toolName) => ({
      name: toolName, description: toolName, inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true },
    }));
    client.callToolImpl = async () => ({
      resultType: "complete", protocolVersion: "2025-11-25",
      content: [{ type: "text", text: `${name} records` }], text: `${name} records`, blocks: [{ type: "text", text: `${name} records` }],
    });
    clients[name].push(client);
    return client;
  });
  const toolCall = (name: string, id: string, input = {}): KotaModelResponse["content"][number] => ({ type: "tool_use", name, id, input });
  const responses = (name: string): KotaModelResponse["content"][] => [
    [toolCall("delegate", `${name}-child`, { task: `Look up ${name} records`, mode: "execute" })],
    [toolCall(`mcp__${name}__lookup`, `${name}-lookup`), toolCall(`mcp__${name}__blocked`, `${name}-blocked`)],
    [{ type: "text", text: `${name} child complete` }],
    [{ type: "text", text: `${name} parent complete` }],
  ];
  const queues = { a: responses("a"), b: responses("b") };
  createModelClientMock.mockImplementation(({ model, apiKey }) => {
    if (apiKey !== "a" && apiKey !== "b") throw new Error("Wrong invocation credentials");
    const name = apiKey;
    return { model, providerName: "openai", client: { messages: { create: vi.fn(), stream: (params) => {
      requests[name].push({ ...params, messages: structuredClone(params.messages) });
      const content = queues[name].shift();
      if (!content) throw new Error(`Unexpected ${name} model request`);
      const stream = makeStubStream({ id: `msg-${name}`, content, stop_reason: content.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn" });
      if (name === "a" && requests.a.length === 1) {
        const finish = stream.finalMessage;
        stream.finalMessage = async () => { startedA.resolve(); await releaseA.promise; return finish(); };
      }
      return stream;
    } } } };
  });
  registerAgentHarness(openaiToolsAgentHarness);
  const launch = (name: "a" | "b") => runAgentHarness(openaiToolsAgentHarness, {
    prompt: `Delegate ${name} lookup`, model: "openai/gpt-5.6-luna", effort: "low",
    cwd: roots[name], scopeRoot: roots[name], systemPrompt: `Only ${name} instructions.`,
    modelProvider: { provider: "openai", apiKey: name },
    mcpServers: { [name]: { command: `fixture-${name}` } }, mcpScopeConfigPolicy: "disabled",
    allowedTools: ["delegate", `mcp__${name}__lookup`, `mcp__${name}__blocked`], disallowedTools: [`mcp__${name}__blocked`],
    autonomyMode: "autonomous", guardrailsConfig: { policies: { safe: "allow", moderate: "allow", dangerous: "deny" } },
  });
  let pendingA: ReturnType<typeof launch> | undefined;
  try {
    for (const root of Object.values(roots)) {
      mkdirSync(join(root, ".kota"));
      writeFileSync(join(root, ".kota", "mcp.json"), JSON.stringify({ mcpServers: { planted: { command: "must-not-launch" } } }));
    }
    pendingA = launch("a");
    void pendingA.catch(() => {});
    await startedA.promise;
    expect((await launch("b")).text).toBe("b parent complete");
    expect(clients.b).toHaveLength(2);
    expect(clients.b.every((client) => client.closeCount === 1)).toBe(true);
    expect(clients.a[0].closeCount).toBe(0);
    releaseA.resolve();
    expect((await pendingA).text).toBe("a parent complete");
    for (const [name, other] of [["a", "b"], ["b", "a"]] as const) {
      expect(requests[name]).toHaveLength(4);
      expect(requests[name][1].tools?.map((tool) => tool.name)).toEqual([`mcp__${name}__lookup`]);
      expect(JSON.stringify(requests[name][1].system)).toContain(`Only ${name} instructions.`);
      expect(JSON.stringify(requests[name])).not.toContain(`mcp__${other}__`);
      expect(requests[name][2].messages.at(-1)?.content).toEqual(expect.arrayContaining([
        expect.objectContaining({ tool_use_id: `${name}-lookup`, is_error: false, content: [{ type: "text", text: `${name} records` }] }),
        expect.objectContaining({ tool_use_id: `${name}-blocked`, is_error: true }),
      ]));
      expect(clients[name]).toHaveLength(2);
      expect(clients[name][0].callToolCalls).toHaveLength(0);
      expect(clients[name][1].callToolCalls, JSON.stringify(requests[name][2].messages)).toHaveLength(1);
      expect(clients[name].every((client) => client.closeCount === 1)).toBe(true);
    }
  } finally {
    releaseA.resolve();
    await pendingA?.catch(() => {});
    factory.mockRestore();
    clearAgentHarnessRegistryForTest();
    for (const root of Object.values(roots)) rmSync(root, { recursive: true, force: true });
  }
});
