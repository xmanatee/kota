import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CostTracker } from "#core/loop/cost.js";
import type { Transport } from "#core/loop/transport.js";

const mockExecuteWithAgentSDK = vi.fn();

vi.mock("#core/agent-sdk/index.js", async () => {
  const actual = await vi.importActual<typeof import("#core/agent-sdk/index.js")>(
    "#core/agent-sdk/index.js",
  );
  return {
    ...actual,
    executeWithAgentSDK: (...args: unknown[]) =>
      mockExecuteWithAgentSDK(...args),
  };
});

await import("#modules/claude-agent-harness/index.js");

const { runDelegateAgentSDK } = await import("./delegate-agent-sdk.js");

function mockTransport(): Transport & {
  messages: Array<{ type: string; message?: string; content?: string }>;
} {
  const messages: Array<{ type: string; message?: string; content?: string }> =
    [];
  return {
    messages,
    emit(event: unknown) {
      messages.push(event as { type: string; message?: string; content?: string });
    },
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Transport & {
    messages: Array<{ type: string; message?: string; content?: string }>;
  };
}

describe("delegate-agent-sdk", () => {
  beforeEach(() => {
    mockExecuteWithAgentSDK.mockReset();
  });

  it("streams progress and returns formatted result", async () => {
    mockExecuteWithAgentSDK.mockImplementation(async (_task, _options, writer) => {
      writer?.write("Working...");
      return {
        text: "Fixed the bug",
        streamedText: "Working...",
        sessionId: "sess-12345678",
        turns: 3,
        totalCostUsd: 0.02,
        subtype: "success",
        isError: false,
      };
    });

    const transport = mockTransport();
    const result = await runDelegateAgentSDK("fix auth bug", "execute", {
      transport,
    });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("Fixed the bug");
    expect(result.content).toContain("agent-sdk");
    expect(transport.messages.some((message) => message.content === "Working...")).toBe(true);
  });

  it("tracks cost through costTracker.addRawCost", async () => {
    mockExecuteWithAgentSDK.mockResolvedValue({
      text: "Done",
      streamedText: "",
      turns: 2,
      totalCostUsd: 0.15,
      subtype: "success",
      isError: false,
    });

    const addRawCost = vi.fn();
    const costTracker = { addRawCost } as unknown as CostTracker;
    await runDelegateAgentSDK("task", "execute", { costTracker });

    expect(addRawCost).toHaveBeenCalledWith(0.15);
  });

  it("passes explore-mode options to the shared executor", async () => {
    mockExecuteWithAgentSDK.mockResolvedValue({
      text: "Found it",
      streamedText: "",
      turns: 1,
      subtype: "success",
      isError: false,
    });

    await runDelegateAgentSDK("find all API endpoints", "explore", {
      cwd: "/tmp/project",
      model: "claude-haiku-4-5-20251001",
      instructionContext: "## Project Instructions\nUse AGENTS.md",
    });

    const [, options] = mockExecuteWithAgentSDK.mock.calls[0];
    expect(options).toMatchObject({
      cwd: "/tmp/project",
      model: "claude-haiku-4-5-20251001",
      permissionMode: "bypassPermissions",
      effort: "xhigh",
    });
    expect(options.maxTurns).toBeUndefined();
    expect(options.allowedTools).toContain("Read");
    expect(options.allowedTools).toContain("Grep");
    expect(options.allowedTools).not.toContain("Edit");
    expect(options.allowedTools).not.toContain("Write");
    expect(options.systemPrompt).toContain("Use AGENTS.md");
  });

  it("passes execute-mode options to the shared executor", async () => {
    mockExecuteWithAgentSDK.mockResolvedValue({
      text: "Done",
      streamedText: "",
      turns: 2,
      subtype: "success",
      isError: false,
    });

    await runDelegateAgentSDK("fix the type error", "execute", {
      cwd: "/tmp/project",
    });

    const [, options] = mockExecuteWithAgentSDK.mock.calls[0];
    expect(options.maxTurns).toBeUndefined();
    expect(options.effort).toBe("xhigh");
    expect(options.allowedTools).toContain("Edit");
    expect(options.allowedTools).toContain("Write");
    expect(options.allowedTools).toContain("Bash");
  });

  it("reports turn limits from executor subtypes", async () => {
    mockExecuteWithAgentSDK.mockResolvedValue({
      text: "Ran out of turns",
      streamedText: "",
      turns: 25,
      subtype: "error_max_turns",
      isError: true,
    });

    const result = await runDelegateAgentSDK("huge refactor", "execute", {});
    expect(result.content).toContain("hit turn limit");
  });

  it("emits start and done status messages", async () => {
    mockExecuteWithAgentSDK.mockResolvedValue({
      text: "Done",
      streamedText: "",
      turns: 2,
      sessionId: "sess-abcdef12",
      subtype: "success",
      isError: false,
    });

    const transport = mockTransport();
    await runDelegateAgentSDK("task", "explore", { transport });

    const statusMessages = transport.messages.filter((message) => message.type === "status");
    expect(statusMessages.length).toBeGreaterThanOrEqual(2);
    expect(statusMessages[0].message).toContain("starting");
    expect(statusMessages[0].message).toContain("agent-sdk");
    expect(statusMessages[statusMessages.length - 1].message).toContain("done");
  });
});
