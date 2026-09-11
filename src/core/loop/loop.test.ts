import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerPreSendHook,
  resetPreSendHooks,
} from "#core/loop/pre-send-hooks.js";
import type { GuardrailsConfig } from "#core/tools/guardrails.js";

// --- Hoisted mock variables (used inside vi.mock factories) ---

const {
  mockStreamMessage,
  mockExecuteToolCalls,
} = vi.hoisted(() => ({
  mockStreamMessage: vi.fn(),
  mockExecuteToolCalls: vi.fn(),
}));

// --- Module mocks ---

vi.mock("#core/model/model-client.js", () => ({
  createModelClient: vi.fn(() => ({
    client: { messages: { stream: vi.fn(), create: vi.fn() } },
    model: "claude-sonnet-4-6",
    providerName: "anthropic",
  })),
  registerModelClientFactory: vi.fn(),
}));
vi.mock("#core/model/streaming.js", () => ({ streamMessage: mockStreamMessage }));
vi.mock("#core/tools/tool-runner.js", async () => {
  const actual = await vi.importActual<typeof import("#core/tools/tool-runner.js")>(
    "#core/tools/tool-runner.js",
  );
  return { ...actual, executeToolCalls: mockExecuteToolCalls };
});
vi.mock("#core/tools/index.js", () => ({
  getAllTools: () => [],
  executeTool: vi.fn(),
  getTodoState: vi.fn(() => ""),
}));
vi.mock("./scope-context.js", () => ({ loadScopeContext: vi.fn(() => "") }));
vi.mock("./instruction-files.js", () => ({ loadInstructionContext: vi.fn(() => "") }));
vi.mock("#root/init.js", () => ({ buildSessionWarmup: vi.fn(() => "") }));
vi.mock("#core/tools/delegate.js", () => ({
  setDelegateConfig: vi.fn(),
  delegateTool: { name: "delegate", description: "", input_schema: { type: "object", properties: {} } },
}));
vi.mock("#core/daemon/task-store.js", () => ({
  initTaskStore: vi.fn(),
  getTaskStore: vi.fn(() => ({
    add: vi.fn(), update: vi.fn(), list: vi.fn(() => []),
    active: vi.fn(() => []), get: vi.fn(), clear: vi.fn(),
    archiveCompleted: vi.fn(() => 0), getActiveSummary: vi.fn(() => null),
    isEmpty: vi.fn(() => true), count: vi.fn(() => 0),
  })),
}));
vi.mock("#core/mcp/manager.js", () => ({
  McpManager: class MockMcpManager {
    static loadConfig() { return null; }
  },
}));
vi.mock("#core/modules/bundled-module-discovery.js", () => ({
  discoverBundledModules: vi.fn(async () => []),
}));
vi.mock("#core/modules/module-discovery.js", () => ({
  discoverModules: vi.fn(async () => []),
}));

// --- Import after mocks ---

import { createModelClient } from "#core/model/model-client.js";
import { AgentSession, runAgentLoop } from "./loop.js";
import { BufferTransport } from "./transport.js";

// --- Helpers ---

function textResponse(text: string, inputTokens = 100) {
  return {
    response: {
      content: [{ type: "text" as const, text }],
      usage: { input_tokens: inputTokens, output_tokens: 50 },
    },
    streamedText: text,
  };
}

function toolResponse(
  tools: Array<{ id: string; name: string; input: Record<string, unknown> }>,
  inputTokens = 100,
) {
  return {
    response: {
      content: tools.map((t) => ({
        type: "tool_use" as const,
        id: t.id,
        name: t.name,
        input: t.input,
      })),
      usage: { input_tokens: inputTokens, output_tokens: 50 },
    },
    streamedText: "",
  };
}

function toolResults(results: Array<{ id: string; content: string; is_error?: boolean }>) {
  return results.map((r) => ({
    tool_use_id: r.id,
    content: r.content,
    is_error: r.is_error,
  }));
}

function executedGuardrailsConfig(callIndex: number): GuardrailsConfig {
  return (mockExecuteToolCalls.mock.calls[callIndex][1] as { guardrailsConfig: GuardrailsConfig }).guardrailsConfig;
}

// --- Tests ---

describe("AgentSession", () => {
  let session: AgentSession;

  beforeEach(() => {
    vi.clearAllMocks();
    resetPreSendHooks();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    session?.close();
    resetPreSendHooks();
    vi.restoreAllMocks();
  });

  it("passes configured model provider options into the model client factory", () => {
    session = new AgentSession({
      autonomyMode: "autonomous",
      model: "openrouter/openrouter/auto",
      config: {
        modelProvider: {
          type: "openrouter",
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: "$OPENROUTER_API_KEY",
        },
      },
    });

    expect(createModelClient).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openrouter/openrouter/auto",
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "$OPENROUTER_API_KEY",
      }),
    );
  });

  describe("text-only response", () => {
    it("returns text from model", async () => {
      session = new AgentSession({ autonomyMode: "autonomous" });
      mockStreamMessage.mockResolvedValueOnce(textResponse("Hello!"));

      const result = await session.send("Hi");

      expect(result).toBe("Hello!");
      expect(mockStreamMessage).toHaveBeenCalledTimes(1);
    });

    it("passes system prompt and messages to streamMessage", async () => {
      session = new AgentSession({ autonomyMode: "autonomous" });
      mockStreamMessage.mockResolvedValueOnce(textResponse("Hi"));

      await session.send("Hello");

      const config = mockStreamMessage.mock.calls[0][0];
      // messages is a reference — first element is the user message
      expect(config.messages[0]).toEqual({ role: "user", content: "Hello" });
      expect(config.system[0].text).toContain("KOTA");
      expect(config.system[0].cache_control).toEqual({ type: "ephemeral" });
    });

    it("aborts active model work when the session closes", async () => {
      session = new AgentSession({ autonomyMode: "autonomous" });
      mockStreamMessage.mockImplementationOnce(({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(signal.reason);
          }, { once: true });
        })
      );

      const sendPromise = session.send("wait");
      await vi.waitFor(() => expect(mockStreamMessage).toHaveBeenCalledTimes(1));
      const assertion = expect(sendPromise).rejects.toThrow("Session closed");

      session.close();

      await assertion;
      expect(mockStreamMessage.mock.calls[0][0].signal.aborted).toBe(true);
    });
  });

  describe("thinking mode", () => {
    it("passes thinking config when enabled", async () => {
      session = new AgentSession({ autonomyMode: "autonomous", thinkingEnabled: true, thinkingBudget: 5000 });
      mockStreamMessage.mockResolvedValueOnce(textResponse("thought"));

      await session.send("think");

      const config = mockStreamMessage.mock.calls[0][0];
      expect(config.thinkingConfig).toEqual({ type: "enabled", budget_tokens: 5000 });
      expect(config.maxTokens).toBe(5000 + 8192);
    });
  });

  describe("tool call loop", () => {
    it("executes one tool round then returns text", async () => {
      session = new AgentSession({ autonomyMode: "autonomous" });
      mockStreamMessage
        .mockResolvedValueOnce(
          toolResponse([{ id: "tu_1", name: "file_read", input: { path: "/tmp/test.txt" } }]),
        )
        .mockResolvedValueOnce(textResponse("File read"));
      mockExecuteToolCalls.mockResolvedValueOnce(toolResults([{ id: "tu_1", content: "hello" }]));

      const result = await session.send("Read file");

      expect(result).toBe("File read");
      expect(mockStreamMessage).toHaveBeenCalledTimes(2);
      expect(mockExecuteToolCalls).toHaveBeenCalledTimes(1);
      expect(mockExecuteToolCalls.mock.calls[0]?.[1]).toMatchObject({
        approvalQueue: session.approvalQueue,
        scopeId: session.scopeId,
      });
    });

    it("passes the active abort signal to tool execution", async () => {
      session = new AgentSession({ autonomyMode: "autonomous" });
      mockStreamMessage
        .mockResolvedValueOnce(
          toolResponse([{ id: "tu_1", name: "shell", input: { command: "sleep 1" } }]),
        )
        .mockResolvedValueOnce(textResponse("done"));
      mockExecuteToolCalls.mockResolvedValueOnce(toolResults([{ id: "tu_1", content: "ok" }]));

      await session.send("run");

      const options = mockExecuteToolCalls.mock.calls[0][1] as { signal?: AbortSignal };
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(options.signal?.aborted).toBe(false);
    });

    it("passes multiple tool blocks in parallel", async () => {
      session = new AgentSession({ autonomyMode: "autonomous" });
      mockStreamMessage
        .mockResolvedValueOnce(
          toolResponse([
            { id: "tu_1", name: "file_read", input: { path: "/a.txt" } },
            { id: "tu_2", name: "grep", input: { pattern: "foo" } },
          ]),
        )
        .mockResolvedValueOnce(textResponse("done"));
      mockExecuteToolCalls.mockResolvedValueOnce(
        toolResults([
          { id: "tu_1", content: "aaa" },
          { id: "tu_2", content: "bbb" },
        ]),
      );

      await session.send("search");

      expect(mockExecuteToolCalls.mock.calls[0][0]).toHaveLength(2);
    });

    it("runs multiple rounds until text response", async () => {
      session = new AgentSession({ autonomyMode: "autonomous" });
      mockStreamMessage
        .mockResolvedValueOnce(
          toolResponse([{ id: "tu_1", name: "grep", input: { pattern: "x" } }]),
        )
        .mockResolvedValueOnce(
          toolResponse([{ id: "tu_2", name: "file_read", input: { path: "/x.ts" } }]),
        )
        .mockResolvedValueOnce(textResponse("All done"));
      mockExecuteToolCalls
        .mockResolvedValueOnce(toolResults([{ id: "tu_1", content: "match" }]))
        .mockResolvedValueOnce(toolResults([{ id: "tu_2", content: "content" }]));

      const result = await session.send("Find and read");

      expect(result).toBe("All done");
      expect(mockStreamMessage).toHaveBeenCalledTimes(3);
      expect(mockExecuteToolCalls).toHaveBeenCalledTimes(2);
    });

    it("uses refreshed guardrails config on the next tool call", async () => {
      session = new AgentSession({
        autonomyMode: "autonomous",
        config: {
          guardrails: {
            policies: { safe: "allow", moderate: "allow", dangerous: "allow" },
          },
        },
      });
      mockStreamMessage
        .mockResolvedValueOnce(
          toolResponse([{ id: "tu_1", name: "process", input: { command: "rm -rf tmp" } }]),
        )
        .mockResolvedValueOnce(textResponse("first done"))
        .mockResolvedValueOnce(
          toolResponse([{ id: "tu_2", name: "process", input: { command: "rm -rf tmp" } }]),
        )
        .mockResolvedValueOnce(textResponse("second done"));
      mockExecuteToolCalls
        .mockResolvedValueOnce(toolResults([{ id: "tu_1", content: "ran" }]))
        .mockResolvedValueOnce(toolResults([{ id: "tu_2", content: "queued" }]));

      await session.send("run dangerous command");
      const before = session.getGuardrailsSnapshot();
      expect(executedGuardrailsConfig(0).policies.dangerous).toBe("allow");

      const replacement = session.replaceGuardrailsConfig({
        policies: { safe: "allow", moderate: "allow", dangerous: "queue" },
      });
      expect(replacement.changed).toBe(true);
      expect(replacement.snapshot.generation).toBe(before.generation + 1);

      await session.send("run dangerous command again");

      expect(executedGuardrailsConfig(1).policies.dangerous).toBe("queue");
    });

    it("does not churn the guardrails snapshot when the policy is unchanged", () => {
      const guardrails: GuardrailsConfig = {
        policies: { safe: "allow", moderate: "allow", dangerous: "queue" },
      };
      session = new AgentSession({
        autonomyMode: "autonomous",
        config: { guardrails },
      });
      const before = session.getGuardrailsSnapshot();

      const replacement = session.replaceGuardrailsConfig(guardrails);

      expect(replacement.changed).toBe(false);
      expect(session.getGuardrailsSnapshot()).toEqual(before);
    });
  });

  describe("failure tracking", () => {
    it("injects guidance after 5 diverse failures", async () => {
      session = new AgentSession({ autonomyMode: "autonomous" });
      for (let i = 0; i < 5; i++) {
        mockStreamMessage.mockResolvedValueOnce(
          toolResponse([{ id: `tu_${i}`, name: "shell", input: { command: `cmd${i}` } }]),
        );
        mockExecuteToolCalls.mockResolvedValueOnce(
          toolResults([{ id: `tu_${i}`, content: `error_${i}`, is_error: true }]),
        );
      }
      mockStreamMessage.mockResolvedValueOnce(textResponse("giving up"));

      await session.send("do something");

      // 5 tool rounds + 1 final text = 6 streamMessage calls
      expect(mockStreamMessage).toHaveBeenCalledTimes(6);
    });

    it("injects circuit break after 3 identical failures", async () => {
      session = new AgentSession({ autonomyMode: "autonomous" });
      for (let i = 0; i < 3; i++) {
        mockStreamMessage.mockResolvedValueOnce(
          toolResponse([{ id: `tu_${i}`, name: "shell", input: { command: "bad" } }]),
        );
        mockExecuteToolCalls.mockResolvedValueOnce(
          toolResults([{ id: `tu_${i}`, content: "same error", is_error: true }]),
        );
      }
      mockStreamMessage.mockResolvedValueOnce(textResponse("stopped"));

      await session.send("do thing");

      expect(mockStreamMessage).toHaveBeenCalledTimes(4);
    });
  });

  describe("pre-send hooks", () => {
    it("runs registered hook before main loop and applies its result", async () => {
      const hook = vi.fn().mockResolvedValue({
        lastResult: "pre-send output",
        assistantText: "hook completed",
        userFollowup: "verify the changes",
      });
      registerPreSendHook("test-hook", hook);

      session = new AgentSession({ autonomyMode: "autonomous" });
      mockStreamMessage.mockResolvedValueOnce(textResponse("verified"));

      const result = await session.send("implement feature");

      expect(hook).toHaveBeenCalledTimes(1);
      expect(result).toBe("verified");
    });

    it("skips applying result when hook returns null", async () => {
      const hook = vi.fn().mockResolvedValue(null);
      registerPreSendHook("test-hook", hook);

      session = new AgentSession({ autonomyMode: "autonomous" });
      mockStreamMessage.mockResolvedValueOnce(textResponse("direct"));

      const result = await session.send("do something");

      expect(hook).toHaveBeenCalledTimes(1);
      expect(result).toBe("direct");
    });
  });

  describe("session persistence", () => {
    it("saves session after tool rounds and at end", async () => {
      const tmpPath = `/tmp/kota-loop-test-${Date.now()}.json`;
      session = new AgentSession({ autonomyMode: "autonomous", sessionPath: tmpPath });
      mockStreamMessage
        .mockResolvedValueOnce(
          toolResponse([{ id: "tu_1", name: "grep", input: { pattern: "x" } }]),
        )
        .mockResolvedValueOnce(textResponse("done"));
      mockExecuteToolCalls.mockResolvedValueOnce(toolResults([{ id: "tu_1", content: "r" }]));

      await session.send("search");

      const { existsSync, unlinkSync } = await import("node:fs");
      expect(existsSync(tmpPath)).toBe(true);
      unlinkSync(tmpPath);
    });
  });

  describe("multiple sends", () => {
    it("maintains context across sends", async () => {
      session = new AgentSession({ autonomyMode: "autonomous" });
      mockStreamMessage
        .mockResolvedValueOnce(textResponse("Hi!"))
        .mockResolvedValueOnce(textResponse("Your name is Bob."));

      await session.send("My name is Bob");
      await session.send("What is my name?");

      const secondConfig = mockStreamMessage.mock.calls[1][0];
      // messages is a reference — final state has 4 (user + assistant + user + assistant)
      // but at call 2 time, the first 3 were present (user, assistant, user)
      expect(secondConfig.messages).toHaveLength(4);
      expect(secondConfig.messages[0]).toEqual({ role: "user", content: "My name is Bob" });
      expect(secondConfig.messages[2]).toEqual({ role: "user", content: "What is my name?" });
    });
  });

  describe("close", () => {
    it("resolves disposal only after its owned module host releases resources", async () => {
      session = new AgentSession({ autonomyMode: "autonomous" });
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const unload = vi
        .spyOn(session.moduleLoader, "unloadAll")
        .mockImplementation(() => blocked);

		const disposal = session.dispose();
		await vi.waitFor(() => expect(unload).toHaveBeenCalledTimes(1));
		release();
		await disposal;
    });

    it("is idempotent", () => {
      session = new AgentSession({ autonomyMode: "autonomous" });
      session.close();
      session.close();
    });

		it("emits Done status on normal disposal", async () => {
			const transport = new BufferTransport();
			session = new AgentSession({ autonomyMode: "autonomous", transport });
			await session.dispose();

      const statuses = transport.getStatusMessages();
      expect(statuses.some((m: string) => m.includes("Done"))).toBe(true);
    });

    it("suppresses Done status when errored=true", () => {
      const transport = new BufferTransport();
      session = new AgentSession({ autonomyMode: "autonomous", transport });
      session.close(true);

      const statuses = transport.getStatusMessages();
      expect(statuses.some((m: string) => m.includes("Done"))).toBe(false);
    });
  });

  describe("runAgentLoop error handling", () => {
    it("does not emit Done when send() throws", async () => {
      const transport = new BufferTransport();
      mockStreamMessage.mockRejectedValueOnce(new Error("auth failed"));

      await expect(runAgentLoop("test", { autonomyMode: "autonomous", transport })).rejects.toThrow("auth failed");

      const statuses = transport.getStatusMessages();
      expect(statuses.some((m: string) => m.includes("Done"))).toBe(false);
    });

    it("emits Done when send() succeeds", async () => {
      const transport = new BufferTransport();
      mockStreamMessage.mockResolvedValueOnce(textResponse("ok"));

      await runAgentLoop("test", { autonomyMode: "autonomous", transport });

      const statuses = transport.getStatusMessages();
      expect(statuses.some((m: string) => m.includes("Done"))).toBe(true);
    });
  });

  describe("cost tracking", () => {
    it("accumulates costs across turns", async () => {
      session = new AgentSession({ autonomyMode: "autonomous" });
      mockStreamMessage
        .mockResolvedValueOnce(
          toolResponse([{ id: "tu_1", name: "grep", input: { pattern: "x" } }], 1000),
        )
        .mockResolvedValueOnce(textResponse("done", 2000));
      mockExecuteToolCalls.mockResolvedValueOnce(toolResults([{ id: "tu_1", content: "r" }]));

      await session.send("search");

      const summary = session.getCostSummary();
      expect(summary).toContain("$");
    });
  });
});
