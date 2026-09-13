import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTokenBudgetLedger, TOKEN_BUDGET_EXHAUSTED_SUBTYPE } from "#core/agent-harness/token-budget.js";
import {
  registerPreSendHook,
  resetPreSendHooks,
} from "#core/loop/pre-send-hooks.js";
import type { GuardrailsConfig } from "#core/tools/guardrails.js";
import { injectSessionEnvironmentVariable, sessionEnvironmentForExecution } from "#core/tools/session-environment.js";
import { resetCleanupHooks } from "./cleanup-hooks.js";

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
  let scopeRoot: string;

  beforeEach(() => {
    scopeRoot = mkdtempSync(join(tmpdir(), "kota-loop-scope-"));
    vi.clearAllMocks();
    resetCleanupHooks();
    resetPreSendHooks();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    await session?.dispose();
    rmSync(scopeRoot, { recursive: true, force: true });
    resetCleanupHooks();
    resetPreSendHooks();
    vi.restoreAllMocks();
  });

  it("passes configured model provider options into the model client factory", () => {
    session = new AgentSession({ scopeRoot,
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

  it("applies refreshed session read restrictions to preloaded model context", async () => {
    writeFileSync(join(scopeRoot, "hint.ts"), "a".repeat(2048));
    session = new AgentSession({ scopeRoot, autonomyMode: "autonomous" });
    const prompts: string[] = [];
    mockStreamMessage.mockImplementation(async ({ messages }) => {
      prompts.push(JSON.stringify(messages.at(-1)));
      return textResponse("done");
    });
    const prompt = "Please examine ./hint.ts for this request";
    await session.send(prompt);
    session.replaceGuardrailsConfig({
      policies: { safe: "allow", moderate: "allow", dangerous: "confirm" },
      toolOverrides: { file_read: "deny" },
    });
    await session.send(prompt);
    expect(prompts[0]).toContain("./hint.ts (~46 lines, 2KB)");
    expect(prompts[1]).not.toContain("Referenced files:");
  });

  describe("text-only response", () => {
    it("passes system prompt and messages to streamMessage", async () => {
      session = new AgentSession({ scopeRoot, autonomyMode: "autonomous" });
      mockStreamMessage.mockResolvedValueOnce(textResponse("Hi"));

      expect(await session.send("Hello")).toBe("Hi");
      expect(mockStreamMessage).toHaveBeenCalledOnce();

      const config = mockStreamMessage.mock.calls[0][0];
      // messages is a reference — first element is the user message
      expect(config.messages[0]).toEqual({ role: "user", content: "Hello" });
      expect(config.system[0].text).toContain("KOTA");
      expect(config.system[0].cache_control).toEqual({ type: "ephemeral" });
    });

    it("aborts active model work when the session closes", async () => {
      session = new AgentSession({ scopeRoot, autonomyMode: "autonomous" });
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
      session = new AgentSession({ scopeRoot, autonomyMode: "autonomous", thinkingEnabled: true, thinkingBudget: 5000 });
      mockStreamMessage.mockResolvedValueOnce(textResponse("thought"));

      await session.send("think");

      const config = mockStreamMessage.mock.calls[0][0];
      expect(config.thinkingConfig).toEqual({ type: "enabled", budget_tokens: 5000 });
      expect(config.maxTokens).toBe(5000 + 8192);
    });
  });

  describe("tool call loop", () => {
    it("feeds batched tool results into later rounds and returns the final stream", async () => {
      session = new AgentSession({ scopeRoot, autonomyMode: "autonomous" });
      const tools = [{ id: "read", name: "file_read", input: { path: "/a.txt" } },
        { id: "search", name: "grep", input: { pattern: "foo" } }];
      mockStreamMessage
        .mockResolvedValueOnce(toolResponse(tools))
        .mockImplementationOnce((config) => {
          expect(config.messages.at(-1)).toEqual({ role: "user", content: [
            { type: "tool_result", tool_use_id: "read", content: "file bytes" },
            { type: "tool_result", tool_use_id: "search", content: "match" },
          ] });
          return toolResponse([{ id: "verify", name: "shell", input: { command: "check" } }]);
        })
        .mockImplementationOnce((config) => {
          expect(config.messages.at(-1)).toEqual({ role: "user", content: [
            { type: "tool_result", tool_use_id: "verify", content: "passed" },
          ] });
          return textResponse("All done");
        });
      mockExecuteToolCalls
        .mockResolvedValueOnce(toolResults([{ id: "read", content: "file bytes" }, { id: "search", content: "match" }]))
        .mockResolvedValueOnce(toolResults([{ id: "verify", content: "passed" }]));

      expect(await session.send("Find and verify")).toBe("All done");
      expect(mockExecuteToolCalls.mock.calls[0][0]).toEqual(tools.map((tool) => ({ type: "tool_use", ...tool })));
      expect(mockExecuteToolCalls.mock.calls[0][1]).toMatchObject({
        approvalQueue: session.approvalQueue, scopeId: session.scopeId,
        signal: expect.any(AbortSignal),
      });
      expect(mockExecuteToolCalls.mock.calls[0][1].signal.aborted).toBe(false);
      expect(mockExecuteToolCalls).toHaveBeenCalledTimes(2);
      expect(mockStreamMessage).toHaveBeenCalledTimes(3);
    });

    it("uses refreshed guardrails config on the next tool call", async () => {
      session = new AgentSession({ scopeRoot,
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
      session = new AgentSession({ scopeRoot,
        autonomyMode: "autonomous",
        config: { guardrails },
      });
      const before = session.getGuardrailsSnapshot();

      const replacement = session.replaceGuardrailsConfig(guardrails);

      expect(replacement.changed).toBe(false);
      expect(session.getGuardrailsSnapshot()).toEqual(before);
    });
  });

  it("feeds repeated-failure guidance into the next model request", async () => {
    const transport = new BufferTransport();
    session = new AgentSession({ scopeRoot, autonomyMode: "autonomous", transport });
    for (let i = 0; i < 3; i++) {
      mockStreamMessage.mockResolvedValueOnce(toolResponse([{ id: `tu_${i}`, name: "shell", input: { command: "bad" } }]));
      mockExecuteToolCalls.mockResolvedValueOnce(toolResults([{ id: `tu_${i}`, content: "same error", is_error: true }]));
    }
    mockStreamMessage.mockImplementationOnce((config) => {
      expect(config.messages.at(-1)).toMatchObject({ role: "user", content: expect.stringContaining("failed") });
      return textResponse("stopped");
    });
    expect(await session.send("do thing")).toBe("stopped");
    expect(transport.events).toContainEqual(expect.objectContaining({ type: "error", message: expect.stringContaining("Circuit breaker") }));
  });

  it.each([null, { assistantText: "hook completed", userFollowup: "verify the changes" }])(
    "applies pre-send output %j before the model request", async (output) => {
      const hook = vi.fn().mockResolvedValue(output);
      registerPreSendHook("test-hook", hook);
      session = new AgentSession({ scopeRoot, autonomyMode: "autonomous" });
      mockStreamMessage.mockImplementationOnce((config) => {
        expect(config.messages).toEqual([
          { role: "user", content: "Hello" },
          ...(output ? [{ role: "assistant", content: output.assistantText }, { role: "user", content: output.userFollowup }] : []),
        ]);
        return textResponse("verified");
      });
      expect(await session.send("Hello")).toBe("verified");
      expect(hook).toHaveBeenCalledOnce();
    },
  );

  describe("session persistence", () => {
    it("saves session after tool rounds and at end", async () => {
      const dir = mkdtempSync(join(tmpdir(), "kota-loop-"));
      const tmpPath = join(dir, "session.json");
      session = new AgentSession({ scopeRoot, autonomyMode: "autonomous", sessionPath: tmpPath });
      mockStreamMessage
        .mockResolvedValueOnce(
          toolResponse([{ id: "tu_1", name: "grep", input: { pattern: "x" } }]),
        )
        .mockResolvedValueOnce(textResponse("done"));
      mockExecuteToolCalls.mockResolvedValueOnce(toolResults([{ id: "tu_1", content: "r" }]));

      try {
        await session.send("search");
        expect(JSON.parse(readFileSync(tmpPath, "utf8")).messages).toEqual([
          { role: "user", content: expect.stringContaining("search") },
          { role: "assistant", content: [{ type: "tool_use", id: "tu_1", name: "grep", input: { pattern: "x" } }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "r" }] },
          { role: "assistant", content: [{ type: "text", text: "done" }] },
        ]);
      } finally {
        await session.dispose();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("multiple sends", () => {
    it("maintains context across sends", async () => {
      session = new AgentSession({ scopeRoot, autonomyMode: "autonomous" });
      mockStreamMessage
        .mockResolvedValueOnce(textResponse("Hi!"))
        .mockImplementationOnce((config) => {
          expect(config.messages).toEqual([
            { role: "user", content: "My name is Bob" },
            { role: "assistant", content: [{ type: "text", text: "Hi!" }] },
            { role: "user", content: expect.stringContaining("What is my name?") },
          ]);
          return textResponse("Your name is Bob.");
        });

      await session.send("My name is Bob");
      await session.send("What is my name?");


    });
  });

  describe("close", () => {
    it("resolves disposal only after its owned module host releases resources", async () => {
      session = new AgentSession({ scopeRoot, autonomyMode: "autonomous" });
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
      session = new AgentSession({ scopeRoot, autonomyMode: "autonomous" });
      session.close();
      session.close();
    });

		it("emits Done status on normal disposal", async () => {
			const transport = new BufferTransport();
			session = new AgentSession({ scopeRoot, autonomyMode: "autonomous", transport });
			await session.dispose();

      const statuses = transport.getStatusMessages();
      expect(statuses.some((m: string) => m.includes("Done"))).toBe(true);
    });

    it("suppresses Done status when errored=true", () => {
      const transport = new BufferTransport();
      session = new AgentSession({ scopeRoot, autonomyMode: "autonomous", transport });
      session.close(true);

      const statuses = transport.getStatusMessages();
      expect(statuses.some((m: string) => m.includes("Done"))).toBe(false);
    });
  });

  describe("runAgentLoop error handling", () => {
    it("does not emit Done when send() throws", async () => {
      const transport = new BufferTransport();
      mockStreamMessage.mockRejectedValueOnce(new Error("auth failed"));

      await expect(runAgentLoop("test", { scopeRoot, autonomyMode: "autonomous", transport })).rejects.toThrow("auth failed");

      const statuses = transport.getStatusMessages();
      expect(statuses.some((m: string) => m.includes("Done"))).toBe(false);
    });

    it("emits Done when send() succeeds", async () => {
      const transport = new BufferTransport();
      mockStreamMessage.mockResolvedValueOnce(textResponse("ok"));

      await runAgentLoop("test", { scopeRoot, autonomyMode: "autonomous", transport });

      const statuses = transport.getStatusMessages();
      expect(statuses.some((m: string) => m.includes("Done"))).toBe(true);
    });
  });

  it.each(["text", "tool"])("rejects exhausted %s output before executing tools or another turn", async (kind) => {
    const tokenBudget = new AgentTokenBudgetLedger({ maxTotalTokens: 100 });
    const transport = new BufferTransport();
    session = new AgentSession({ scopeRoot, autonomyMode: "autonomous", tokenBudget, transport });
    mockStreamMessage.mockResolvedValueOnce(kind === "text" ? textResponse("done", 80)
      : toolResponse([{ id: "read", name: "grep", input: { pattern: "x" } }], 80));
    await expect(session.send("search")).rejects.toMatchObject({ name: TOKEN_BUDGET_EXHAUSTED_SUBTYPE });
    expect(mockStreamMessage).toHaveBeenCalledOnce();
    expect(mockExecuteToolCalls).not.toHaveBeenCalled();
    expect(tokenBudget.snapshot()).toMatchObject({
      usage: { inputTokens: 80, outputTokens: 50, totalTokens: 130 },
      exhausted: true, exhaustedBy: { kind: "session-turn", turn: 1 },
    });
    expect(transport.events).toContainEqual(expect.objectContaining({
      type: "error", message: expect.stringContaining("Agent token budget exhausted"),
    }));
  });

  it("registers the scoped credential overlay and erases it on close", () => {
    session = new AgentSession({ scopeRoot, autonomyMode: "autonomous" });
    const identity = { sessionId: session.sessionId, scopeId: session.scopeId };
    injectSessionEnvironmentVariable(identity, "KOTA_LOOP_SESSION_SECRET", "temporary-value");
    expect(sessionEnvironmentForExecution(identity)).toEqual({ KOTA_LOOP_SESSION_SECRET: "temporary-value" });
    session.close();
    expect(sessionEnvironmentForExecution(identity)).toEqual({});
  });
});
