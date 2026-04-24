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
  AgentHarnessRunOptions,
  AgentHarnessWriter,
} from "#core/agent-harness/index.js";
import type { ReplChrome } from "#core/modules/provider-types.js";
import { composeTranscriptPrompt, runHarnessRepl } from "#core/repl/index.js";
import { claudeAgentHarness } from "#modules/claude-agent-harness/adapter.js";
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
  beforeEach(() => {
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
    vi.restoreAllMocks();
  });

  it("rejects harnesses that do not support multi-turn", async () => {
    const singleTurnHarness: AgentHarness = {
      name: "one-shot",
      description: "single-turn only",
      supportsMultiTurn: false,
      supportedHookKinds: ["preRun", "postRun"],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      run: async (): Promise<AgentHarnessResult> => ({
        text: "",
        streamedText: "",
        turns: 0,
        isError: false,
      }),
    };

    await expect(
      runHarnessRepl({
        harness: singleTurnHarness,
        model: "irrelevant",
        cwd: process.cwd(),
        run: { effort: "xhigh" },
        input: makeInput(["hi", "exit"]),
        chrome: new CapturingChrome(),
        output: new CapturingOutput(),
      }),
    ).rejects.toThrow(/one-shot.*does not support multi-turn/);
  });

  it("announces harness + model before the first turn", async () => {
    const captured: AgentHarnessRunOptions[] = [];
    const harness: AgentHarness = {
      name: "stub",
      description: "stub for banner test",
      supportsMultiTurn: true,
      supportedHookKinds: ["preRun", "postRun"],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      run: async (options): Promise<AgentHarnessResult> => {
        captured.push(options);
        return {
          text: "ok",
          streamedText: "ok",
          turns: 1,
          isError: false,
        };
      },
    };

    const chrome = new CapturingChrome();
    await runHarnessRepl({
      harness,
      model: "test-model-x",
      cwd: process.cwd(),
      run: { effort: "xhigh" },
      input: makeInput(["hi", "exit"]),
      chrome,
      output: new CapturingOutput(),
    });

    const announce = chrome.events.find((e) => e.kind === "announce");
    expect(announce).toMatchObject({
      kind: "announce",
      harness: { name: "stub" },
      model: "test-model-x",
    });
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
      cwd: process.cwd(),
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
    expect(secondCall.messages[0].content).toContain("nice to meet you");
    expect(secondCall.messages[0].content).toContain("what is my name?");
    expect(output.chunks.join("")).toContain("nice to meet you");
    expect(output.chunks.join("")).toContain("your name is Michael");
  });

  it("carries transcript context across turns for the claude-agent-sdk adapter", async () => {
    executeWithAgentSDKMock
      .mockResolvedValueOnce({
        text: "sure thing",
        streamedText: "sure thing",
        turns: 1,
        isError: false,
      })
      .mockResolvedValueOnce({
        text: "yes, I recall",
        streamedText: "yes, I recall",
        turns: 1,
        isError: false,
      });

    await runHarnessRepl({
      harness: claudeAgentHarness,
      model: "claude-sonnet-4-6",
      cwd: process.cwd(),
      run: { effort: "xhigh" },
      input: makeInput(["remember blue", "what color?", "exit"]),
      chrome: new CapturingChrome(),
      output: new CapturingOutput(),
    });

    expect(executeWithAgentSDKMock).toHaveBeenCalledTimes(2);
    const [firstPrompt] = executeWithAgentSDKMock.mock.calls[0] as [string];
    const [secondPrompt] = executeWithAgentSDKMock.mock.calls[1] as [string];
    expect(firstPrompt).toBe("remember blue");
    expect(secondPrompt).toContain("remember blue");
    expect(secondPrompt).toContain("sure thing");
    expect(secondPrompt).toContain("what color?");
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
      run: async (options): Promise<AgentHarnessResult> => {
        calls.push(options.prompt);
        return { text: "ack", streamedText: "ack", turns: 1, isError: false };
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
      run: async (options, writer?: AgentHarnessWriter) => {
        prompts.push(options.prompt);
        writer?.write("ok");
        return { text: "ok", streamedText: "ok", turns: 1, isError: false };
      },
    };

    const chrome = new CapturingChrome();
    await runHarnessRepl({
      harness,
      model: "m",
      cwd: process.cwd(),
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
      run: async () => {
        call += 1;
        if (call === 1) throw new Error("boom");
        return { text: "recovered", streamedText: "recovered", turns: 1, isError: false };
      },
    };

    const chrome = new CapturingChrome();
    await runHarnessRepl({
      harness,
      model: "m",
      cwd: process.cwd(),
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
