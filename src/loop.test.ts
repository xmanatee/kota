import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCleanupHook, resetCleanupHooks } from "#core/loop/cleanup-hooks.js";

// --- Hoisted mock variables (used inside vi.mock factories) ---

const {
  mockStreamMessage,
  mockExecuteToolCalls,
  mockArchitectPass,
  mockEditorLoop,
  mockVerifyTracker,
} = vi.hoisted(() => ({
  mockStreamMessage: vi.fn(),
  mockExecuteToolCalls: vi.fn(),
  mockArchitectPass: vi.fn(),
  mockEditorLoop: vi.fn(),
  mockVerifyTracker: {
    getState: vi.fn(() => ""),
    recordEdit: vi.fn(),
    checkShellCommand: vi.fn(),
    tick: vi.fn(),
  },
}));

// --- Module mocks ---

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { stream: vi.fn() };
  },
}));
vi.mock("./core/model/model-client.js", () => ({
  createModelClient: vi.fn(() => ({
    client: { messages: { stream: vi.fn(), create: vi.fn() } },
    model: "claude-sonnet-4-6",
    providerName: "anthropic",
  })),
  registerModelClientFactory: vi.fn(),
}));
vi.mock("./core/model/streaming.js", () => ({ streamMessage: mockStreamMessage }));
vi.mock("./core/tools/tool-runner.js", async () => {
  const actual = await vi.importActual<typeof import("./core/tools/tool-runner.js")>(
    "./core/tools/tool-runner.js",
  );
  return { ...actual, executeToolCalls: mockExecuteToolCalls };
});
vi.mock("./core/tools/index.js", () => ({
  getAllTools: () => [],
  executeTool: vi.fn(),
  getTodoState: vi.fn(() => ""),
}));
vi.mock("./project-context.js", () => ({ loadProjectContext: vi.fn(() => "") }));
vi.mock("./instruction-files.js", () => ({ loadInstructionContext: vi.fn(() => "") }));
vi.mock("./init.js", () => ({ buildSessionWarmup: vi.fn(() => "") }));
vi.mock("./core/tools/delegate.js", () => ({
  setDelegateConfig: vi.fn(),
  delegateTool: { name: "delegate", description: "", input_schema: { type: "object", properties: {} } },
}));
vi.mock("./modules/execution/process.js", () => ({
  cleanupProcesses: vi.fn(),
  processTool: { name: "process", description: "", input_schema: { type: "object", properties: {} } },
  runProcess: vi.fn(),
}));
vi.mock("./modules/execution/code-exec.js", () => ({
  cleanupSessions: vi.fn(),
  codeExecTool: { name: "code_exec", description: "", input_schema: { type: "object", properties: {} } },
  runCodeExec: vi.fn(),
}));
vi.mock("./core/daemon/task-store.js", () => ({
  initTaskStore: vi.fn(),
  getTaskStore: vi.fn(() => ({
    add: vi.fn(), update: vi.fn(), list: vi.fn(() => []),
    active: vi.fn(() => []), get: vi.fn(), clear: vi.fn(),
    archiveCompleted: vi.fn(() => 0), getActiveSummary: vi.fn(() => null),
    isEmpty: vi.fn(() => true), count: vi.fn(() => 0),
  })),
}));
vi.mock("./core/mcp/manager.js", () => ({
  McpManager: class MockMcpManager {
    static loadConfig() { return null; }
  },
}));
vi.mock("#core/loop/verify-tracker.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#core/loop/verify-tracker.js")>();
  return {
    ...actual,
    VerifyTracker: class MockVerifyTracker {
      getState = mockVerifyTracker.getState;
      recordEdit = mockVerifyTracker.recordEdit;
      checkShellCommand = mockVerifyTracker.checkShellCommand;
      tick = mockVerifyTracker.tick;
    },
    detectVerifyCommands: vi.fn(() => []),
  };
});
vi.mock("./core/architect/architect.js", () => ({
  runArchitectPass: mockArchitectPass,
}));

vi.mock("./core/architect/architect-editor.js", () => ({
  runEditorLoop: mockEditorLoop,
}));
vi.mock("./core/modules/project-discovery.js", () => ({
  discoverProjectModules: vi.fn(async () => []),
}));
vi.mock("./core/modules/module-discovery.js", () => ({
  discoverModules: vi.fn(async () => []),
}));

// --- Import after mocks ---

import { Context } from "./core/loop/context.js";
import { AgentSession, runAgentLoop } from "./core/loop/loop.js";
import { BufferTransport } from "./core/loop/transport.js";

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

// --- Tests ---

describe("AgentSession", () => {
  let session: AgentSession;

  beforeEach(() => {
    vi.clearAllMocks();
    resetCleanupHooks();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    session?.close();
    resetCleanupHooks();
    vi.restoreAllMocks();
  });

  describe("text-only response", () => {
    it("returns text from model", async () => {
      session = new AgentSession();
      mockStreamMessage.mockResolvedValueOnce(textResponse("Hello!"));

      const result = await session.send("Hi");

      expect(result).toBe("Hello!");
      expect(mockStreamMessage).toHaveBeenCalledTimes(1);
    });

    it("passes system prompt and messages to streamMessage", async () => {
      session = new AgentSession();
      mockStreamMessage.mockResolvedValueOnce(textResponse("Hi"));

      await session.send("Hello");

      const config = mockStreamMessage.mock.calls[0][0];
      // messages is a reference — first element is the user message
      expect(config.messages[0]).toEqual({ role: "user", content: "Hello" });
      expect(config.system[0].text).toContain("KOTA");
      expect(config.system[0].cache_control).toEqual({ type: "ephemeral" });
    });
  });

  describe("thinking mode", () => {
    it("passes thinking config when enabled", async () => {
      session = new AgentSession({ thinkingEnabled: true, thinkingBudget: 5000 });
      mockStreamMessage.mockResolvedValueOnce(textResponse("thought"));

      await session.send("think");

      const config = mockStreamMessage.mock.calls[0][0];
      expect(config.thinkingConfig).toEqual({ type: "enabled", budget_tokens: 5000 });
      expect(config.maxTokens).toBe(5000 + 8192);
    });
  });

  describe("tool call loop", () => {
    it("executes one tool round then returns text", async () => {
      session = new AgentSession();
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
    });

    it("passes multiple tool blocks in parallel", async () => {
      session = new AgentSession();
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
      session = new AgentSession();
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
  });

  describe("observation masking timing", () => {
    it("calls maskOldObservations before LLM call each turn", async () => {
      session = new AgentSession();
      const maskSpy = vi.spyOn(Context.prototype, "maskOldObservations");
      mockStreamMessage.mockResolvedValueOnce(textResponse("ok", 110_000));

      await session.send("test");

      // maskOldObservations called once per turn (pre-LLM call)
      expect(maskSpy).toHaveBeenCalledTimes(1);
      maskSpy.mockRestore();
    });

    it("calls maskOldObservations once per turn in multi-turn loop", async () => {
      session = new AgentSession();
      const maskSpy = vi.spyOn(Context.prototype, "maskOldObservations");
      mockStreamMessage
        .mockResolvedValueOnce(
          toolResponse([{ id: "tu_1", name: "grep", input: { pattern: "x" } }], 110_000),
        )
        .mockResolvedValueOnce(textResponse("done", 110_000));
      mockExecuteToolCalls.mockResolvedValueOnce(toolResults([{ id: "tu_1", content: "r" }]));

      await session.send("search");

      // 2 turns × 1 mask call = 2
      expect(maskSpy).toHaveBeenCalledTimes(2);
      maskSpy.mockRestore();
    });
  });

  describe("verify tracking", () => {
    it("records file_edit", async () => {
      session = new AgentSession();
      mockStreamMessage
        .mockResolvedValueOnce(
          toolResponse([{ id: "tu_1", name: "file_edit", input: { path: "/src/main.ts" } }]),
        )
        .mockResolvedValueOnce(textResponse("edited"));
      mockExecuteToolCalls.mockResolvedValueOnce(toolResults([{ id: "tu_1", content: "ok" }]));

      await session.send("edit");

      expect(mockVerifyTracker.recordEdit).toHaveBeenCalledWith("/src/main.ts");
    });

    it("records file_write", async () => {
      session = new AgentSession();
      mockStreamMessage
        .mockResolvedValueOnce(
          toolResponse([{ id: "tu_1", name: "file_write", input: { path: "/new.ts" } }]),
        )
        .mockResolvedValueOnce(textResponse("written"));
      mockExecuteToolCalls.mockResolvedValueOnce(toolResults([{ id: "tu_1", content: "ok" }]));

      await session.send("create");

      expect(mockVerifyTracker.recordEdit).toHaveBeenCalledWith("/new.ts");
    });

    it("records each file in multi_edit", async () => {
      session = new AgentSession();
      mockStreamMessage
        .mockResolvedValueOnce(
          toolResponse([
            {
              id: "tu_1",
              name: "multi_edit",
              input: { edits: [{ file_path: "/a.ts" }, { file_path: "/b.ts" }] },
            },
          ]),
        )
        .mockResolvedValueOnce(textResponse("done"));
      mockExecuteToolCalls.mockResolvedValueOnce(toolResults([{ id: "tu_1", content: "ok" }]));

      await session.send("batch");

      expect(mockVerifyTracker.recordEdit).toHaveBeenCalledWith("/a.ts");
      expect(mockVerifyTracker.recordEdit).toHaveBeenCalledWith("/b.ts");
    });

    it("does not check shell commands when result is error", async () => {
      session = new AgentSession();
      mockStreamMessage
        .mockResolvedValueOnce(
          toolResponse([{ id: "tu_1", name: "shell", input: { command: "npm test" } }]),
        )
        .mockResolvedValueOnce(textResponse("done"));
      mockExecuteToolCalls.mockResolvedValueOnce(
        toolResults([{ id: "tu_1", content: "FAIL", is_error: true }]),
      );

      await session.send("test");

      expect(mockVerifyTracker.checkShellCommand).not.toHaveBeenCalled();
    });

    it("records files from find_replace result", async () => {
      session = new AgentSession();
      mockStreamMessage
        .mockResolvedValueOnce(
          toolResponse([{ id: "tu_1", name: "find_replace", input: { glob: "**/*.ts", pattern: "old", replacement: "new" } }]),
        )
        .mockResolvedValueOnce(textResponse("done"));
      mockExecuteToolCalls.mockResolvedValueOnce(
        toolResults([{
          id: "tu_1",
          content: "Replaced 3 occurrence(s) in 2 file(s):\n  /src/a.ts: 2 replacement(s)\n  /src/b.ts: 1 replacement(s)",
        }]),
      );

      await session.send("rename");

      expect(mockVerifyTracker.recordEdit).toHaveBeenCalledWith("/src/a.ts");
      expect(mockVerifyTracker.recordEdit).toHaveBeenCalledWith("/src/b.ts");
    });

    it("records files from delegate execute result", async () => {
      session = new AgentSession();
      mockStreamMessage
        .mockResolvedValueOnce(
          toolResponse([{ id: "tu_1", name: "delegate", input: { mode: "execute", task: "fix" } }]),
        )
        .mockResolvedValueOnce(textResponse("done"));
      mockExecuteToolCalls.mockResolvedValueOnce(
        toolResults([{
          id: "tu_1",
          content: "execute: 3/15 turns | tools: file_edit\nFixed the bug\n\n--- Modified files (2) ---\n  - /src/main.ts\n  - /src/util.ts",
        }]),
      );

      await session.send("delegate fix");

      expect(mockVerifyTracker.recordEdit).toHaveBeenCalledWith("/src/main.ts");
      expect(mockVerifyTracker.recordEdit).toHaveBeenCalledWith("/src/util.ts");
    });

    it("does NOT record delegate explore (no modified files)", async () => {
      session = new AgentSession();
      mockStreamMessage
        .mockResolvedValueOnce(
          toolResponse([{ id: "tu_1", name: "delegate", input: { mode: "explore", task: "research" } }]),
        )
        .mockResolvedValueOnce(textResponse("done"));
      mockExecuteToolCalls.mockResolvedValueOnce(
        toolResults([{
          id: "tu_1",
          content: "explore: 3/10 turns | tools: file_read, grep\nFound the relevant code.",
        }]),
      );

      await session.send("research");

      expect(mockVerifyTracker.recordEdit).not.toHaveBeenCalled();
    });

    it("does NOT record find_replace dry run", async () => {
      session = new AgentSession();
      mockStreamMessage
        .mockResolvedValueOnce(
          toolResponse([{ id: "tu_1", name: "find_replace", input: { glob: "**/*.ts", pattern: "old", replacement: "new", dry_run: true } }]),
        )
        .mockResolvedValueOnce(textResponse("done"));
      mockExecuteToolCalls.mockResolvedValueOnce(
        toolResults([{
          id: "tu_1",
          content: "Dry run — 3 match(es) in 2 file(s):\n  /src/a.ts: 2 match(es)\n  /src/b.ts: 1 match(es)",
        }]),
      );

      await session.send("preview");

      expect(mockVerifyTracker.recordEdit).not.toHaveBeenCalled();
    });

    it("does NOT record edit when tool result is an error", async () => {
      session = new AgentSession();
      mockStreamMessage
        .mockResolvedValueOnce(
          toolResponse([{ id: "tu_1", name: "file_edit", input: { path: "/bad.ts" } }]),
        )
        .mockResolvedValueOnce(textResponse("failed"));
      mockExecuteToolCalls.mockResolvedValueOnce(
        toolResults([{ id: "tu_1", content: "not found", is_error: true }]),
      );

      await session.send("edit");

      expect(mockVerifyTracker.recordEdit).not.toHaveBeenCalled();
    });

    it("ticks after each tool round", async () => {
      session = new AgentSession();
      mockStreamMessage
        .mockResolvedValueOnce(
          toolResponse([{ id: "tu_1", name: "grep", input: { pattern: "x" } }]),
        )
        .mockResolvedValueOnce(textResponse("found"));
      mockExecuteToolCalls.mockResolvedValueOnce(toolResults([{ id: "tu_1", content: "m" }]));

      await session.send("search");

      expect(mockVerifyTracker.tick).toHaveBeenCalledTimes(1);
    });
  });

  describe("failure tracking", () => {
    it("injects guidance after 5 diverse failures", async () => {
      session = new AgentSession();
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
      session = new AgentSession();
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

  describe("architect mode", () => {
    it("runs architect then editor pass before main loop", async () => {
      session = new AgentSession({ architectMode: true });
      mockArchitectPass.mockResolvedValueOnce("Step 1: create file...");
      mockEditorLoop.mockResolvedValueOnce({ text: "Created file.ts", modifiedFiles: ["file.ts"] });
      mockStreamMessage.mockResolvedValueOnce(textResponse("verified"));

      const result = await session.send("implement feature");

      expect(result).toBe("verified");
      expect(mockArchitectPass).toHaveBeenCalledTimes(1);
      expect(mockEditorLoop).toHaveBeenCalledTimes(1);
    });

    it("skips editor pass when architect returns empty plan", async () => {
      session = new AgentSession({ architectMode: true });
      mockArchitectPass.mockResolvedValueOnce("");
      mockStreamMessage.mockResolvedValueOnce(textResponse("nothing to do"));

      await session.send("do something");

      expect(mockEditorLoop).not.toHaveBeenCalled();
    });
  });

  describe("session persistence", () => {
    it("saves session after tool rounds and at end", async () => {
      const tmpPath = `/tmp/kota-loop-test-${Date.now()}.json`;
      session = new AgentSession({ sessionPath: tmpPath });
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
      session = new AgentSession();
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
    it("runs registered cleanup hooks", () => {
      const cleanup = vi.fn();
      registerCleanupHook("test-cleanup", cleanup);

      session = new AgentSession();
      session.close();

      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it("is idempotent", () => {
      session = new AgentSession();
      session.close();
      session.close();
    });

    it("emits Done status on normal close", () => {
      const transport = new BufferTransport();
      session = new AgentSession({ transport });
      session.close();

      const statuses = transport.getStatusMessages();
      expect(statuses.some((m: string) => m.includes("Done"))).toBe(true);
    });

    it("suppresses Done status when errored=true", () => {
      const transport = new BufferTransport();
      session = new AgentSession({ transport });
      session.close(true);

      const statuses = transport.getStatusMessages();
      expect(statuses.some((m: string) => m.includes("Done"))).toBe(false);
    });
  });

  describe("runAgentLoop error handling", () => {
    it("does not emit Done when send() throws", async () => {
      const transport = new BufferTransport();
      mockStreamMessage.mockRejectedValueOnce(new Error("auth failed"));

      await expect(runAgentLoop("test", { transport })).rejects.toThrow("auth failed");

      const statuses = transport.getStatusMessages();
      expect(statuses.some((m: string) => m.includes("Done"))).toBe(false);
    });

    it("emits Done when send() succeeds", async () => {
      const transport = new BufferTransport();
      mockStreamMessage.mockResolvedValueOnce(textResponse("ok"));

      await runAgentLoop("test", { transport });

      const statuses = transport.getStatusMessages();
      expect(statuses.some((m: string) => m.includes("Done"))).toBe(true);
    });
  });

  describe("cost tracking", () => {
    it("accumulates costs across turns", async () => {
      session = new AgentSession();
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
