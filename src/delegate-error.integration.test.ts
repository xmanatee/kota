/**
 * Cross-module integration tests: delegate × tool-retry × error pipeline
 *
 * Tests error flow through the delegate's internal loop: tool failures,
 * circuit breaking, transient retry, and result formatting.
 * Exercises: delegate.ts × tool-retry.ts × delegate-format.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Hoisted mock runner — accessible inside vi.mock factory
const { mockRunner } = vi.hoisted(() => ({
  mockRunner: vi.fn<(input: Record<string, unknown>) => Promise<{ content: string; is_error?: boolean }>>(),
}));

vi.mock("./delegate-prompts.js", () => ({
  EXPLORE_PROMPT: "Test explore prompt",
  EXECUTE_PROMPT: "Test execute prompt",
  buildSubAgentPrompt: () => "test system prompt",
  exploreTools: [
    { name: "shell", description: "test shell", input_schema: { type: "object", properties: { command: { type: "string" } } } },
  ],
  executeTools: [
    { name: "shell", description: "test shell", input_schema: { type: "object", properties: { command: { type: "string" } } } },
  ],
  exploreRunners: { shell: (input: Record<string, unknown>) => mockRunner(input) },
  executeRunners: { shell: (input: Record<string, unknown>) => mockRunner(input) },
}));

import { setDelegateConfig, runDelegate } from "./tools/delegate.js";

function mockStream(response: unknown) {
  const obj = {
    on: vi.fn(() => obj),
    finalMessage: vi.fn().mockResolvedValue(response),
  };
  return obj;
}

function textMsg(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

function toolUseMsg(id: string, name: string, input: Record<string, unknown>) {
  return {
    content: [{ type: "tool_use" as const, id, name, input }],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

function makeMockClient(responses: unknown[]) {
  let idx = 0;
  return {
    messages: {
      stream: vi.fn(() => mockStream(responses[idx++])),
    },
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe("delegate × tool-retry error pipeline (cross-module)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockRunner.mockReset();
  });

  it("circuit breaks after 3 identical tool errors", async () => {
    const error = { content: "Error: ENOENT /no/such/file", is_error: true };
    mockRunner.mockResolvedValue(error);

    const client = makeMockClient([
      toolUseMsg("t1", "shell", { command: "cat /no/such/file" }),
      toolUseMsg("t2", "shell", { command: "cat /no/such/file" }),
      toolUseMsg("t3", "shell", { command: "cat /no/such/file" }),
    ]);

    setDelegateConfig({ model: "test", client });
    const result = await runDelegate({ task: "find files", mode: "explore" });

    expect(result.content).toContain("stopped: repeated errors");
    expect(result.content).toContain("repeated the same failing operation");
    expect(mockRunner).toHaveBeenCalledTimes(3);
  });

  it("does not circuit break on varied errors", async () => {
    mockRunner
      .mockResolvedValueOnce({ content: "Error: file not found", is_error: true })
      .mockResolvedValueOnce({ content: "Error: permission denied", is_error: true })
      .mockResolvedValueOnce({ content: "Error: syntax error", is_error: true });

    const client = makeMockClient([
      toolUseMsg("t1", "shell", { command: "cmd1" }),
      toolUseMsg("t2", "shell", { command: "cmd2" }),
      toolUseMsg("t3", "shell", { command: "cmd3" }),
      textMsg("Tried 3 approaches, all failed."),
    ]);

    setDelegateConfig({ model: "test", client });
    const result = await runDelegate({ task: "debug issue", mode: "explore" });

    expect(result.content).not.toContain("stopped: repeated errors");
    expect(result.content).not.toContain("hit turn limit");
    expect(result.content).toContain("Tried 3 approaches");
  });

  it("handles unknown tool gracefully without crashing", async () => {
    // API returns a tool_use for a tool not in the runners map
    const client = makeMockClient([
      {
        content: [{ type: "tool_use", id: "u1", name: "nonexistent_tool", input: {} }],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
      textMsg("Tool not available, here is my answer."),
    ]);

    setDelegateConfig({ model: "test", client });
    const result = await runDelegate({ task: "do something", mode: "explore" });

    expect(result.content).toContain("Tool not available");
    expect(result.is_error).toBeFalsy();
  });

  it("recovers after errors when subsequent tools succeed", async () => {
    mockRunner
      .mockResolvedValueOnce({ content: "Error: not found", is_error: true })
      .mockResolvedValueOnce({ content: "file contents here", is_error: false });

    const client = makeMockClient([
      toolUseMsg("t1", "shell", { command: "cat missing.txt" }),
      toolUseMsg("t2", "shell", { command: "cat found.txt" }),
      textMsg("Found the file."),
    ]);

    setDelegateConfig({ model: "test", client });
    const result = await runDelegate({ task: "read files", mode: "explore" });

    expect(result.content).not.toContain("stopped: repeated errors");
    expect(result.content).not.toContain("hit turn limit");
    expect(result.content).toContain("Found the file");
  });

  it("reaches turn limit after max turns", async () => {
    mockRunner.mockResolvedValue({ content: "ok", is_error: false });

    // Explore mode has 10 turn limit — fill all with tool calls
    const responses = Array.from({ length: 10 }, (_, i) =>
      toolUseMsg(`t${i}`, "shell", { command: `step ${i}` }),
    );

    const client = makeMockClient(responses);
    setDelegateConfig({ model: "test", client });
    const result = await runDelegate({ task: "long task", mode: "explore" });

    expect(result.content).toContain("hit turn limit");
    expect(mockRunner).toHaveBeenCalledTimes(10);
  });

  it("retries transient errors via maybeRetry (delegate × tool-retry)", async () => {
    // First call: transient ETIMEDOUT error → maybeRetry retries
    // Second call (retry): success
    mockRunner
      .mockResolvedValueOnce({ content: "Error: connect ETIMEDOUT 10.0.0.1:443", is_error: true })
      .mockResolvedValueOnce({ content: "HTTP 200 OK — response body", is_error: false });

    const client = makeMockClient([
      toolUseMsg("t1", "shell", { command: "curl http://example.com" }),
      textMsg("Got the response."),
    ]);

    setDelegateConfig({ model: "test", client });
    const result = await runDelegate({ task: "fetch data", mode: "explore" });

    // mockRunner called twice: original + retry
    expect(mockRunner).toHaveBeenCalledTimes(2);
    // Delegate completed normally — retry succeeded, no circuit break
    expect(result.content).not.toContain("circuit_break");
    expect(result.content).toContain("Got the response");
  });
});
