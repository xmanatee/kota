import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const messagesCreateMock = vi.fn();
const createModelClientMock = vi.fn();
const executeWithAgentSDKMock = vi.fn();

vi.mock("#core/model/model-client.js", () => ({
  createModelClient: (...args: unknown[]) => createModelClientMock(...args),
}));

vi.mock("#modules/claude-agent-harness/executor.js", async (importActual) => {
  const actual = await importActual<typeof import("#modules/claude-agent-harness/executor.js")>();
  return {
    ...actual,
    executeWithAgentSDK: (...args: unknown[]) => executeWithAgentSDKMock(...args),
  };
});

import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessWriter,
} from "#core/agent-harness/index.js";
import { runAgentHarness, UNKNOWN_AGENT_USAGE } from "#core/agent-harness/index.js";
import { resetAgentConversation } from "#core/agent-harness/session-continuity.js";
import type { ReplChrome } from "#core/modules/provider-types.js";
import { claudeAgentHarness } from "#modules/claude-agent-harness/adapter.js";
import { openHarnessResumeConversation } from "#modules/history/harness-resume.js";
import { ConversationHistory } from "#modules/history/history.js";
import { getScopeHistoryDir } from "#modules/history/history-utils.js";
import { composeTranscriptPrompt, runHarnessRepl } from "#modules/repl/index.js";
import { thinAgentHarness } from "#modules/thin-agent-harness/adapter.js";

function makeInput(lines: string[]): Readable {
  return Readable.from(lines.map((l) => `${l}\n`));
}

type ChromeEvent =
  | { kind: "announce"; harness: { name: string; description: string }; model: string }
  | { kind: "help"; commands: Record<string, string> }
  | { kind: "status"; harness: string; model: string; turns: number }
  | { kind: "reset" }
  | { kind: "error"; message: string }
  | { kind: "goodbye" };

class CapturingChrome implements ReplChrome {
  readonly events: ChromeEvent[] = [];

  announceHarness(harness: { name: string; description: string }, model: string): void {
    this.events.push({ kind: "announce", harness, model });
  }
  showHelp(commands: Record<string, string>): void {
    this.events.push({ kind: "help", commands });
  }
  showStatus(harness: string, model: string, turns: number): void {
    this.events.push({ kind: "status", harness, model, turns });
  }
  showReset(): void {
    this.events.push({ kind: "reset" });
  }
  showError(message: string): void {
    this.events.push({ kind: "error", message });
  }
  showGoodbye(): void {
    this.events.push({ kind: "goodbye" });
  }
}

class CapturingOutput {
  readonly chunks: string[] = [];
  write(text: string): boolean {
    this.chunks.push(text);
    return true;
  }
}

describe("runHarnessRepl", () => {
  let scopeRoot: string;
  beforeEach(() => {
    scopeRoot = mkdtempSync(join(tmpdir(), "kota-repl-continuity-"));
    messagesCreateMock.mockReset();
    createModelClientMock.mockReset();
    executeWithAgentSDKMock.mockReset();

    createModelClientMock.mockImplementation(({ model }: { model: string }) => ({
      client: { messages: { create: messagesCreateMock, stream: vi.fn() } },
      model,
      providerName: "anthropic",
    }));
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("carries transcript context across turns for the thin adapter", async () => {
    messagesCreateMock
      .mockResolvedValueOnce({
        id: "msg_1",
        content: [{ type: "text", text: "nice to meet you" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      })
      .mockResolvedValueOnce({
        id: "msg_2",
        content: [{ type: "text", text: "your name is Michael" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });

    const output = new CapturingOutput();
    await runHarnessRepl({
      harness: thinAgentHarness,
      model: "claude-haiku-4-5-20251001",
      cwd: scopeRoot,
      run: {
        effort: "xhigh",
        systemPrompt: "be terse",
      },
      input: makeInput(["my name is Michael", "what is my name?", "exit"]),
      chrome: new CapturingChrome(),
      output,
    });

    expect(messagesCreateMock).toHaveBeenCalledTimes(2);
    const firstCall = messagesCreateMock.mock.calls[0][0] as {
      messages: { role: string; content: string }[];
    };
    const secondCall = messagesCreateMock.mock.calls[1][0] as {
      messages: { role: string; content: string }[];
    };
    expect(firstCall.messages[0].content).toBe("my name is Michael");
    expect(secondCall.messages[0].content).toContain("my name is Michael");
    expect(secondCall.messages[1].content).toEqual([{ type: "text", text: "nice to meet you" }]);
    expect(secondCall.messages[2].content).toContain("what is my name?");
    expect(output.chunks.join("")).toContain("nice to meet you");
    expect(output.chunks.join("")).toContain("your name is Michael");
  });

  it("carries transcript context across turns for the claude-agent-sdk adapter", async () => {
    executeWithAgentSDKMock
      .mockResolvedValueOnce({
        sessionId: "claude-repl-conversation",
        text: "sure thing",
        streamedText: "sure thing",
        turns: 1,
        usage: UNKNOWN_AGENT_USAGE,
        isError: false,
      })
      .mockResolvedValueOnce({
        sessionId: "claude-repl-conversation",
        text: "yes, I recall",
        streamedText: "yes, I recall",
        turns: 1,
        usage: UNKNOWN_AGENT_USAGE,
        isError: false,
      });

    await runHarnessRepl({
      harness: claudeAgentHarness,
      model: "claude-sonnet-4-6",
      cwd: scopeRoot,
      run: { effort: "xhigh" },
      input: makeInput(["remember blue", "what color?", "exit"]),
      chrome: new CapturingChrome(),
      output: new CapturingOutput(),
    });

    expect(executeWithAgentSDKMock).toHaveBeenCalledTimes(2);
    const [firstPrompt] = executeWithAgentSDKMock.mock.calls[0] as [string];
    const [secondPrompt] = executeWithAgentSDKMock.mock.calls[1] as [string];
    expect(firstPrompt).toBe("remember blue");
    expect(executeWithAgentSDKMock.mock.calls[1][1].resumeSessionId).toBe("claude-repl-conversation");
    expect(secondPrompt).toContain("what color?");
  });

  it("resumes an explicitly owned conversation in a replacement REPL and resets its native identity", async () => {
    messagesCreateMock.mockResolvedValue({ id: "response", content: [{ type: "text", text: "blue remembered" }], usage: { input_tokens: 1, output_tokens: 1 } });
    let sessionId: string | undefined;
    const chrome = new CapturingChrome();
    const base = { harness: thinAgentHarness, model: "claude-haiku-4-5-20251001", cwd: scopeRoot, chrome, output: new CapturingOutput() };
    await runHarnessRepl({ ...base, run: { effort: "high" }, input: makeInput(["remember blue", "exit"]), onAssistantResponse: (_turn, result) => { sessionId = result.sessionId; } });
    const original = sessionId;
    await runHarnessRepl({ ...base, run: { effort: "high", resumeSessionId: original }, input: makeInput(["what color?", "/reset", "new topic", "exit"]), onAssistantResponse: (_turn, result) => { sessionId = result.sessionId; } });
    expect(chrome.events.filter((event) => event.kind === "error")).toEqual([]);
    expect(messagesCreateMock.mock.calls[1][0].messages).toEqual(expect.arrayContaining([{ role: "assistant", content: [{ type: "text", text: "blue remembered" }] }]));
    expect(messagesCreateMock.mock.calls[2][0].messages).toEqual([{ role: "user", content: "new topic" }]);
    expect(sessionId).not.toBe(original);
  });

  // Detects history import overriding the shared checkpoint/reset decision in the REPL.
  it("resumes beyond a stale history snapshot and honors resets on repeated history imports", async () => {
    const model = "claude-haiku-4-5-20251001";
    const continuityKey = "interactive:history";
    const run = { effort: "high" as const, model, scopeRoot, cwd: scopeRoot, continuityKey };
    messagesCreateMock.mockResolvedValue({ id: "response", content: [{ type: "text", text: "blue remembered" }], usage: { input_tokens: 1, output_tokens: 1 } });
    await runAgentHarness(thinAgentHarness, { ...run, prompt: "remember blue" });
    const history = new ConversationHistory(getScopeHistoryDir(scopeRoot));
    const id = history.create(model, scopeRoot, "user", continuityKey);
    history.save(id, [{ role: "user", content: "remember blue" }, { role: "assistant", content: "blue remembered" }], 0, 0);
    messagesCreateMock.mockRejectedValueOnce(new Error("authentication unavailable"));
    await expect(runAgentHarness(thinAgentHarness, { ...run, prompt: "checkpoint newer than history" })).rejects.toThrow("authentication unavailable");

    const chrome = new CapturingChrome();
    const resume = async (lines: string[]) => {
      const store = openHarnessResumeConversation(scopeRoot, id);
      await runHarnessRepl({
        harness: thinAgentHarness, model, cwd: scopeRoot,
        run: { effort: "high", continuityKey: store.continuityKey },
        initialTranscript: store.transcript,
        onUserInput: store.appendUserInput, onAssistantResponse: (_turn, result) => store.appendAssistantResult(result),
        input: makeInput([...lines, "exit"]), chrome, output: new CapturingOutput(),
      });
    };
    await resume(["continue"]);
    const restored = messagesCreateMock.mock.calls[2][0].messages;
    expect(JSON.stringify(restored)).toContain("checkpoint newer than history");
    expect(restored.at(-1).content).not.toContain("remember blue");
    resetAgentConversation(scopeRoot, continuityKey, "Operator reset outside the REPL");
    await resume(["fresh topic"]);
    expect(messagesCreateMock.mock.calls[3][0].messages).toEqual([{ role: "user", content: "fresh topic" }]);
    await resume(["/reset", "another topic"]);
    expect(messagesCreateMock.mock.calls[4][0].messages).toEqual([{ role: "user", content: "another topic" }]);
    expect(chrome.events.filter((event) => event.kind === "error")).toEqual([]);
  });

  it("seeds legacy history once and allows reset before the first imported turn", async () => {
    messagesCreateMock.mockResolvedValue({ id: "response", content: [{ type: "text", text: "ack" }], usage: { input_tokens: 1, output_tokens: 1 } });
    const base = {
      harness: thinAgentHarness, model: "claude-haiku-4-5-20251001", cwd: scopeRoot,
      initialTranscript: [{ user: "legacy question", assistant: "legacy answer" }],
      chrome: new CapturingChrome(), output: new CapturingOutput(),
    };
    await runHarnessRepl({ ...base, run: { effort: "high", continuityKey: "legacy" }, input: makeInput(["continue", "again", "exit"]) });
    expect(messagesCreateMock.mock.calls[0][0].messages[0].content).toContain("legacy question");
    expect(messagesCreateMock.mock.calls[1][0].messages.at(-1).content).not.toContain("legacy question");
    await runHarnessRepl({ ...base, run: { effort: "high", continuityKey: "reset-before-first-turn" }, input: makeInput(["/reset", "fresh topic", "exit"]) });
    expect(messagesCreateMock.mock.calls[2][0].messages).toEqual([{ role: "user", content: "fresh topic" }]);
  });

  it("expands @path references at the REPL boundary, not inside any adapter", async () => {
    const tmpDir = process.cwd();
    const calls: string[] = [];
    const harness: AgentHarness = {
      name: "capture",
      description: "captures prompt",
      supportsMultiTurn: true,
      supportedHookKinds: ["preRun", "postRun"],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: async (options): Promise<AgentHarnessResult> => {
        calls.push(options.prompt);
        return {
          text: "ack",
          streamedText: "ack",
          turns: 1,
          usage: UNKNOWN_AGENT_USAGE,
          isError: false,
        };
      },
    };

    await runHarnessRepl({
      harness,
      model: "irrelevant",
      cwd: tmpDir,
      run: { effort: "xhigh" },
      input: makeInput(["read @package.json please", "exit"]),
      chrome: new CapturingChrome(),
      output: new CapturingOutput(),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('<file path="package.json">');
    expect(calls[0]).toContain('"name": "kota"');
  });

  it("handles /reset by dropping the transcript", async () => {
    const prompts: string[] = [];
    const harness: AgentHarness = {
      name: "reset-test",
      description: "",
      supportsMultiTurn: true,
      supportedHookKinds: ["preRun", "postRun"],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: async (options, writer?: AgentHarnessWriter) => {
        prompts.push(options.prompt);
        writer?.write("ok");
        return {
          text: "ok",
          streamedText: "ok",
          turns: 1,
          usage: UNKNOWN_AGENT_USAGE,
          isError: false,
        };
      },
    };

    const chrome = new CapturingChrome();
    await runHarnessRepl({
      harness,
      model: "m",
      cwd: scopeRoot,
      run: { effort: "xhigh" },
      input: makeInput(["first", "/reset", "second", "exit"]),
      chrome,
      output: new CapturingOutput(),
    });

    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toBe("first");
    expect(prompts[1]).toBe("second");
    expect(chrome.events.some((e) => e.kind === "reset")).toBe(true);
  });

  it("surfaces harness errors without exiting the loop", async () => {
    let call = 0;
    const harness: AgentHarness = {
      name: "flaky",
      description: "",
      supportsMultiTurn: true,
      supportedHookKinds: ["preRun", "postRun"],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: async () => {
        call += 1;
        if (call === 1) throw new Error("boom");
        return {
          text: "recovered",
          streamedText: "recovered",
          turns: 1,
          usage: UNKNOWN_AGENT_USAGE,
          isError: false,
        };
      },
    };

    const chrome = new CapturingChrome();
    await runHarnessRepl({
      harness,
      model: "m",
      cwd: scopeRoot,
      run: { effort: "xhigh" },
      input: makeInput(["first", "second", "exit"]),
      chrome,
      output: new CapturingOutput(),
    });

    expect(call).toBe(2);
    const errorEvent = chrome.events.find((e) => e.kind === "error");
    expect(errorEvent).toMatchObject({ kind: "error", message: "boom" });
  });
});

describe("composeTranscriptPrompt", () => {
  it("returns the raw input on the first turn", () => {
    expect(composeTranscriptPrompt([], "hi")).toBe("hi");
  });

  it("wraps prior turns in <user>/<assistant> tags and appends the current input", () => {
    const composed = composeTranscriptPrompt(
      [
        { user: "hello", assistant: "hi back" },
      ],
      "how are you?",
    );
    expect(composed).toContain("<user>\nhello\n</user>");
    expect(composed).toContain("<assistant>\nhi back\n</assistant>");
    expect(composed.endsWith("<user>\nhow are you?\n</user>")).toBe(true);
  });
});
