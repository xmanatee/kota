import { afterEach, describe, expect, it, vi } from "vitest";
import { BufferTransport } from "#core/loop/transport.js";
import type { McpManager } from "#core/mcp/manager.js";
import type { MessageStreamParams } from "#core/model/model-client.js";
import { createDelegateBudget, runDelegate, setDelegateConfig } from "./delegate.js";
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

afterEach(() => {
  clearCustomTools();
});

describe("runDelegate runner context", () => {
  afterEach(() => {
    setDelegateConfig({ model: "gpt-5.6-sol" });
  });

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
    setDelegateConfig({
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
      },
    );

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
  afterEach(() => {
    setDelegateConfig({ model: "gpt-5.6-sol" });
  });

  it("runs a normal delegate call under the default budget and reports budget status", async () => {
    const stream = vi.fn(
      (_params: MessageStreamParams) =>
        new TestStream(modelResponse([{ type: "text", text: "done" }])),
    );
    const transport = new BufferTransport();
    setDelegateConfig({
      model: "test-model",
      modelOutputTokenLimits: { "test-model": 1234 },
      client: modelClient(stream),
      transport,
    });

    const result = await runDelegate({ task: "Inspect the project", mode: "explore" });

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
    setDelegateConfig({
      model: "test-model",
      modelOutputTokenLimits: { "test-model": 1234 },
      client: modelClient(stream),
      delegateBudget: budget,
    });
    const parent = budget.tryStart();
    if (!parent.ok) throw new Error(parent.failure.message);

    try {
      const result = await parent.lease.run(() =>
        runDelegate({ task: "Start a child delegate", mode: "execute" }),
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
    setDelegateConfig({
      model: "test-model",
      modelOutputTokenLimits: { "test-model": 1234 },
      client: modelClient(stream),
      mcpManager,
      delegateBudget: budget,
    });

    const result = await runDelegate({ task: "Execute at the depth limit", mode: "execute" });

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
    setDelegateConfig({
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
          runDelegate({ task: "Start first child", mode: "execute" }),
          runDelegate({ task: "Start second child", mode: "execute" }),
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
