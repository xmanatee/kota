import { afterEach, describe, expect, it, vi } from "vitest";
import { BufferTransport } from "#core/loop/transport.js";
import type { McpManager } from "#core/mcp/manager.js";
import type { MessageStreamParams } from "#core/model/model-client.js";
import type { DelegationRuntime } from "#core/tools/delegation-runtime.js";
import { createDelegateBudget, resolveDelegateConfig, runDelegate } from "./delegate.js";
import {
  modelClient,
  modelResponse,
  TestStream,
  testTool,
} from "./delegate-test-support.js";
import { localWriteEffect } from "./effect.js";
import {
  clearCustomTools,
  registerTool,
  type ToolRunnerContext,
} from "./index.js";

let delegationConfig: DelegationRuntime;

afterEach(() => {
  clearCustomTools();
});

describe("runDelegate runner context", () => {

  it("passes selected scope context through the bounded shell runner", async () => {
    let receivedInput: Record<string, unknown> | undefined;
    let receivedContext: ToolRunnerContext | undefined;
    registerTool(
      testTool("shell"),
      async (input, context) => {
        receivedInput = input;
        receivedContext = context;
        return { content: `cwd:${context?.cwd ?? "missing"}` };
      },
      undefined,
      { effect: localWriteEffect() },
    );

    const stream = vi
      .fn()
      .mockReturnValueOnce(
        new TestStream(
          modelResponse([
            {
              type: "tool_use",
              id: "toolu_shell",
              name: "shell",
              input: { command: "pwd", timeout_ms: 999_999 },
            },
          ]),
        ),
      )
      .mockReturnValueOnce(
        new TestStream(modelResponse([{ type: "text", text: "finished" }])),
      );
    delegationConfig = resolveDelegateConfig({ effort: "low",
      model: "test-model",
      modelOutputTokenLimits: { "test-model": 1234 },
      client: modelClient(stream),
    });

    const result = await runDelegate(
      { task: "Run a nested shell command", mode: "execute" },
      {
        cwd: "/tmp/scope-b",
        scopeId: "scope-b",
        sessionId: "session-b",
        toolUseId: "parent-tool",
      }, delegationConfig);

    expect(result.is_error).toBeUndefined();
    expect(receivedInput).toMatchObject({
      command: "pwd",
      timeout_ms: 60_000,
    });
    expect(receivedContext).toMatchObject({
      cwd: "/tmp/scope-b",
      scopeId: "scope-b",
      sessionId: "session-b",
      toolUseId: "toolu_shell",
    });
    expect(stream.mock.calls[0][0].system[0].text).toContain(
      "Working directory: /tmp/scope-b",
    );
  });
});

describe("runDelegate recursive budget", () => {

  it("runs a normal delegate call under the default budget and reports budget status", async () => {
    const stream = vi.fn(
      (_params: MessageStreamParams) =>
        new TestStream(modelResponse([{ type: "text", text: "done" }])),
    );
    const transport = new BufferTransport();
    delegationConfig = resolveDelegateConfig({ effort: "low",
      model: "test-model",
      modelOutputTokenLimits: { "test-model": 1234 },
      client: modelClient(stream),
      transport,
    });

    const result = await runDelegate({ task: "Inspect the project", mode: "explore" }, undefined, delegationConfig);

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("done");
    expect(stream).toHaveBeenCalledTimes(1);
    expect(
      transport.getStatusMessages().some((message) =>
        message.includes("[budget depth 1/2, active 1/4]"),
      ),
    ).toBe(true);
  });

  it("rejects a nested execute delegate at the recursive depth limit before model dispatch", async () => {
    const stream = vi.fn(
      (_params: MessageStreamParams) =>
        new TestStream(modelResponse([{ type: "text", text: "should not run" }])),
    );
    const budget = createDelegateBudget({ maxDepth: 1, maxActiveChildren: 4 });
    delegationConfig = resolveDelegateConfig({ effort: "low",
      model: "test-model",
      modelOutputTokenLimits: { "test-model": 1234 },
      client: modelClient(stream),
      delegateBudget: budget,
    });
    const parent = budget.tryStart();
    if (!parent.ok) throw new Error(parent.failure.message);

    try {
      const result = await parent.lease.run(() =>
        runDelegate({ task: "Start a child delegate", mode: "execute" }, undefined, delegationConfig),
      );

      expect(result.is_error).toBe(true);
      expect(result.content).toContain("delegate budget exhausted");
      expect(result.content).toContain("maximum recursive depth 1 exceeded");
      expect(result._meta?.delegateBudget).toMatchObject({
        limit: "depth",
        depth: 1,
        requestedDepth: 2,
        maxDepth: 1,
      });
      expect(stream).not.toHaveBeenCalled();
    } finally {
      parent.lease.release();
    }
  });

  it("omits the delegate tool from sub-agent tools when the call is already at the depth limit", async () => {
    let streamedRequest: MessageStreamParams | undefined;
    const stream = vi.fn((request: MessageStreamParams) => {
      streamedRequest = request;
      return new TestStream(modelResponse([{ type: "text", text: "done at limit" }]));
    });
    const mcpManager = {
      getTools: () => [
        {
          name: "delegate",
          description: "Recursive delegate",
          input_schema: { type: "object" as const, properties: {} },
        },
      ],
      isMcpTool: vi.fn(() => false),
      executeTool: vi.fn(),
    } as unknown as McpManager;
    const budget = createDelegateBudget({ maxDepth: 1, maxActiveChildren: 4 });
    delegationConfig = resolveDelegateConfig({ effort: "low",
      model: "test-model",
      modelOutputTokenLimits: { "test-model": 1234 },
      client: modelClient(stream),
      mcpManager,
      delegateBudget: budget,
    });

    const result = await runDelegate({ task: "Execute at the depth limit", mode: "execute" }, undefined, delegationConfig);

    expect(result.is_error).toBeUndefined();
    expect(stream).toHaveBeenCalledTimes(1);
    expect(streamedRequest).toBeDefined();
    const toolNames = streamedRequest?.tools?.map((tool) => tool.name) ?? [];
    expect(toolNames).not.toContain("delegate");
  });

  it("rejects parallel child delegate calls beyond the active-child limit", async () => {
    const stream = vi.fn(
      (_params: MessageStreamParams) =>
        new TestStream(modelResponse([{ type: "text", text: "first child done" }])),
    );
    const budget = createDelegateBudget({ maxDepth: 2, maxActiveChildren: 2 });
    delegationConfig = resolveDelegateConfig({ effort: "low",
      model: "test-model",
      modelOutputTokenLimits: { "test-model": 1234 },
      client: modelClient(stream),
      delegateBudget: budget,
    });
    const parent = budget.tryStart();
    if (!parent.ok) throw new Error(parent.failure.message);

    try {
      const [first, second] = await parent.lease.run(() =>
        Promise.all([
          runDelegate({ task: "Start first child", mode: "execute" }, undefined, delegationConfig),
          runDelegate({ task: "Start second child", mode: "execute" }, undefined, delegationConfig),
        ]),
      );

      expect(first.is_error).toBeUndefined();
      expect(first.content).toContain("first child done");
      expect(second.is_error).toBe(true);
      expect(second.content).toContain("active child delegate limit 2 exceeded");
      expect(second._meta?.delegateBudget).toMatchObject({
        limit: "active_children",
        depth: 1,
        requestedDepth: 2,
        activeChildren: 2,
        maxActiveChildren: 2,
      });
      expect(stream).toHaveBeenCalledTimes(1);
    } finally {
      parent.lease.release();
    }
  });
});

it("keeps interleaved sessions, delayed MCP initialization and nested delegates with their owner", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { AgentSession } = await import("#core/loop/loop.js");
  const { ModuleLoader } = await import("#core/modules/module-loader.js");
  const { AgentTokenBudgetLedger } = await import("#core/agent-harness/token-budget.js");
  const ports = await import("#core/mcp/manager-client-port.js");
  const { FakeMcpManagerClient } = await import("#core/mcp/manager-test-support.js");
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  };
  const initA = deferred();
  const childB = deferred();
  const startedB = deferred();
  const clients = { a: new FakeMcpManagerClient("a"), b: new FakeMcpManagerClient("b") };
  for (const name of ["a", "b"] as const) {
    clients[name].tools = [{ name: "lookup", description: `Look up ${name} records.`, inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }];
    clients[name].callToolImpl = async () => ({
      resultType: "complete", protocolVersion: "2025-11-25",
      content: [{ type: "text", text: `${name} records` }], text: `${name} records`, blocks: [{ type: "text", text: `${name} records` }],
    });
  }
  clients.a.listToolsImpl = async () => { await initA.promise; return clients.a.tools; };
  const factory = vi.spyOn(ports, "createMcpManagerClient").mockImplementation((_transport, name) => {
    if (name !== "a" && name !== "b") throw new Error(`Unexpected MCP server ${name}`);
    return clients[name];
  });
  const disposeNested = registerTool(testTool("nested_delegate"),
    (input, context) => runDelegate(input, context), "delegation-fixture", { effect: localWriteEffect() });
  const roots: string[] = [];
  const sessions: InstanceType<typeof AgentSession>[] = [];
  const requests: Record<string, MessageStreamParams[]> = { a: [], b: [] };
  const transports = { a: new BufferTransport(), b: new BufferTransport() };
  const budgets = { a: new AgentTokenBudgetLedger({ maxTotalTokens: 100 }), b: new AgentTokenBudgetLedger({ maxTotalTokens: 200 }) };
  function call(name: string, task: string) {
    return modelResponse([{ type: "tool_use", id: task, name, input: name === "delegate" || name === "nested_delegate" ? { task, mode: "execute" } : {} }]);
  }
  const responses = {
    a: [call("delegate", "a-child"), call("nested_delegate", "a-grandchild"), call("mcp__a__lookup", "a-lookup"), modelResponse([{ type: "text", text: "a grandchild done" }]), modelResponse([{ type: "text", text: "a child done" }]), modelResponse([{ type: "text", text: "a parent done" }])],
    b: [call("delegate", "b-child"), call("mcp__b__lookup", "b-lookup"), modelResponse([{ type: "text", text: "b child done" }]), modelResponse([{ type: "text", text: "b parent done" }])],
  };
  try {
    for (const name of ["a", "b"] as const) {
      const root = mkdtempSync(join(tmpdir(), `kota-delegation-${name}-`));
      roots.push(root);
      writeFileSync(join(root, "AGENTS.md"), `Only use ${name} instructions.\n`);
      const model = name === "a" ? "gpt-5.6-sol" : "gpt-5.6-terra";
      const stream = (request: MessageStreamParams) => {
        requests[name].push({ ...request, messages: structuredClone(request.messages) });
        const response = responses[name].shift();
        if (!response) throw new Error(`Unexpected ${name} request`);
        let textListener: ((text: string) => void) | undefined;
        const held = name === "b" && requests.b.length === 2;
        return {
          on(event: "text" | "thinking", listener: (text: string) => void) { if (event === "text") textListener = listener; return this; },
          async finalMessage() {
            if (held) { startedB.resolve(); await childB.promise; }
            for (const block of response.content) if (block.type === "text") textListener?.(block.text);
            return response;
          },
        };
      };
      sessions.push(new AgentSession({
        scopeRoot: root, autonomyMode: "autonomous", noHistory: true,
        model, client: modelClient(stream), transport: transports[name], tokenBudget: budgets[name],
        moduleLoader: new ModuleLoader({}, false, { scopeRoot: root }),
        mcpServers: { [name]: { command: "unused-test-port" } },
        config: {
          modelTiers: { fast: model, balanced: model, capable: model },
          defaultAgentEffort: name === "a" ? "low" : "medium",
          modelProvider: { type: "openai", baseUrl: `https://${name}.invalid`, apiKey: `fixture-${name}` },
          guardrails: { policies: { safe: "allow", moderate: "allow", dangerous: "deny" } },
        },
      }));
    }
    const b = sessions[1].send("Delegate b work");
    void b.catch(() => {});
    await startedB.promise;
    const a = sessions[0].send("Delegate a work");
    expect(requests.a).toHaveLength(0);
    initA.resolve();
    expect(await a).toBe("a parent done");
    expect(requests.b).toHaveLength(2);
    await sessions[0].dispose();
    expect(clients.a.closeCount).toBe(1);
    expect(clients.b.closeCount).toBe(0);
    childB.resolve();
    expect(await b).toBe("b parent done");
    for (const [index, name, other, count] of [[0, "a", "b", 6], [1, "b", "a", 4]] as const) {
      expect(requests[name]).toHaveLength(count);
      for (const request of requests[name]) {
        expect(request.model).toBe(name === "a" ? "gpt-5.6-sol" : "gpt-5.6-terra");
        expect(JSON.stringify(request.system)).toContain(`Only use ${name} instructions`);
        expect(JSON.stringify(request.system)).not.toContain(`Only use ${other} instructions`);
        expect(request.tools?.map((tool) => tool.name)).toContain(`mcp__${name}__lookup`);
        expect(request.tools?.map((tool) => tool.name)).not.toContain(`mcp__${other}__lookup`);
      }
      for (const request of requests[name].slice(1, -1)) expect(request.effort).toBe(name === "a" ? "low" : "medium");
      expect(clients[name].callToolCalls).toHaveLength(1);
      expect(JSON.stringify(requests[name])).toContain(`${name} records`);
      expect(JSON.stringify(transports[name].events)).not.toContain(`${other} child done`);
      expect(sessions[index].getCostSummary()).toContain(`(${count} in, ${count} out)`);
      expect(budgets[name].snapshot().usage.totalTokens).toBe(count * 2);
    }
    await sessions[1].dispose();
    expect(clients.b.closeCount).toBe(1);
    await expect(sessions[0].send("after close")).rejects.toThrow("Session is closed");
    expect(await runDelegate({ task: "outside a session" })).toMatchObject({ is_error: true, content: expect.stringContaining("owning delegation runtime") });
  } finally {
    initA.resolve(); childB.resolve();
    await Promise.all(sessions.map((session) => session.dispose()));
    factory.mockRestore();
    disposeNested();
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
});
