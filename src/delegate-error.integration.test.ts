/**
 * Cross-module integration tests: delegate × tool-retry × error pipeline
 *
 * Tests error flow through the delegate's internal loop: tool failures,
 * circuit breaking, transient retry, and result formatting.
 * Exercises: delegate.ts × tool-retry.ts × delegate-format.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getToolMiddleware, resetToolMiddleware } from "./core/tools/tool-middleware.js";
import { createRetryMiddleware } from "./modules/tool-retry/tool-retry.js";

// Hoisted mock runner — accessible inside vi.mock factory
const { mockRunner } = vi.hoisted(() => ({
  mockRunner: vi.fn<(input: Record<string, unknown>) => Promise<{ content: string; is_error?: boolean }>>(),
}));

vi.mock("./delegate-prompts.js", () => {
  const testShellTool = { name: "shell", description: "test shell", input_schema: { type: "object", properties: { command: { type: "string" } } } };
  const testRunners = {
    shell: (input: Record<string, unknown>) => mockRunner(input),
    web_fetch: (input: Record<string, unknown>) => mockRunner(input),
    http_request: (input: Record<string, unknown>) => mockRunner(input),
  };
  return {
    EXPLORE_PROMPT: "Test explore prompt",
    EXECUTE_PROMPT: "Test execute prompt",
    RESEARCH_PROMPT: "Test research prompt",
    buildSubAgentPrompt: () => "test system prompt",
    exploreTools: [testShellTool],
    executeTools: [testShellTool],
    researchTools: [testShellTool],
    exploreRunners: testRunners,
    executeRunners: testRunners,
    researchRunners: testRunners,
  };
});

import { runDelegate, setDelegateConfig } from "./core/tools/delegate.js";

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

  afterEach(() => {
    resetToolMiddleware();
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

  it("retries transient errors via middleware (delegate × tool-retry)", async () => {
    // Register retry middleware — normally loaded by the tool-retry module
    getToolMiddleware().add("tool-retry", createRetryMiddleware(() => Promise.resolve()), { priority: 20 });

    // First call: transient ETIMEDOUT error → middleware retries
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

  it("retries transient API errors (429/503) with backoff", async () => {
    const err429 = Object.assign(new Error("Rate limit exceeded"), { status: 429 });
    let callCount = 0;
    const client = {
      messages: {
        stream: vi.fn(() => {
          callCount++;
          if (callCount <= 2) throw err429;
          return mockStream(textMsg("Done after retry."));
        }),
      },
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    setDelegateConfig({ model: "test", client });
    const result = await runDelegate({ task: "rate limited task", mode: "explore" });

    expect(callCount).toBe(3); // 2 failures + 1 success
    expect(result.content).toContain("Done after retry.");
    expect(result.is_error).toBeFalsy();
  });

  it("returns structured error for fatal API errors (401)", async () => {
    const err401 = Object.assign(new Error("Invalid API key"), { status: 401 });
    const client = {
      messages: {
        stream: vi.fn(() => { throw err401; }),
      },
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    setDelegateConfig({ model: "test", client });
    const result = await runDelegate({ task: "auth test", mode: "explore" });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Sub-agent API error");
    expect(result.content).toContain("Invalid API key");
  });

  it("returns structured error when all API retries exhausted", async () => {
    const err503 = Object.assign(new Error("Service unavailable"), { status: 503 });
    const client = {
      messages: {
        stream: vi.fn(() => { throw err503; }),
      },
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    setDelegateConfig({ model: "test", client });
    const result = await runDelegate({ task: "unavailable", mode: "explore" });

    // Should have attempted 3 times (initial + 2 retries) then returned error
    expect(client.messages.stream).toHaveBeenCalledTimes(3);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Sub-agent API error");
    expect(result.content).toContain("Service unavailable");
  });

  it("catches tool runner exceptions without crashing delegation", async () => {
    mockRunner.mockRejectedValueOnce(new Error("Segfault in runner"));

    const client = makeMockClient([
      toolUseMsg("t1", "shell", { command: "crash" }),
      textMsg("Recovered after tool crash."),
    ]);

    setDelegateConfig({ model: "test", client });
    const result = await runDelegate({ task: "crash test", mode: "explore" });

    expect(result.content).toContain("Recovered after tool crash.");
    expect(result.is_error).toBeFalsy();
  });

  it("formats caught runner exception as is_error tool result", async () => {
    // Runner throws, then model gives up
    mockRunner.mockRejectedValue(new Error("Runtime crash"));

    const client = makeMockClient([
      toolUseMsg("t1", "shell", { command: "boom" }),
      toolUseMsg("t2", "shell", { command: "boom" }),
      toolUseMsg("t3", "shell", { command: "boom" }),
    ]);

    setDelegateConfig({ model: "test", client });
    const result = await runDelegate({ task: "crashing tool", mode: "explore" });

    // Circuit breaker should trigger on repeated identical tool errors
    expect(result.content).toContain("stopped: repeated errors");
    expect(result.content).toContain("Tool error (shell): Runtime crash");
  });

  it("preserves partial progress on API error after turns", async () => {
    mockRunner.mockResolvedValue({ content: "step done", is_error: false });
    const err500 = Object.assign(new Error("Internal server error"), { status: 500 });
    let callCount = 0;
    const client = {
      messages: {
        stream: vi.fn(() => {
          callCount++;
          if (callCount === 1) return mockStream(toolUseMsg("t1", "shell", { command: "step1" }));
          // Fail all retries on second turn
          throw err500;
        }),
      },
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    setDelegateConfig({ model: "test", client });
    const result = await runDelegate({ task: "partial work", mode: "explore" });

    // First turn succeeded (1 call), second turn failed after 3 attempts
    expect(callCount).toBe(4); // 1 success + 3 failed
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Sub-agent API error after 1 turn(s)");
  });

  it("retries API error mid-delegation and resumes turns", async () => {
    mockRunner.mockResolvedValue({ content: "ok", is_error: false });
    let callCount = 0;
    const client = {
      messages: {
        stream: vi.fn(() => {
          callCount++;
          // Turn 1: success
          if (callCount === 1) return mockStream(toolUseMsg("t1", "shell", { command: "step1" }));
          // Turn 2, attempt 1: transient failure
          if (callCount === 2) throw Object.assign(new Error("socket hang up"), { status: 502 });
          // Turn 2, attempt 2: success
          if (callCount === 3) return mockStream(textMsg("Completed after retry."));
          return mockStream(textMsg("unexpected"));
        }),
      },
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    setDelegateConfig({ model: "test", client });
    const result = await runDelegate({ task: "retry mid", mode: "explore" });

    expect(callCount).toBe(3);
    expect(result.content).toContain("Completed after retry.");
    expect(result.is_error).toBeFalsy();
  });

  it("tracks http_request URLs in sources section", async () => {
    mockRunner.mockResolvedValue({ content: '{"data": "ok"}', is_error: false });

    const client = makeMockClient([
      {
        content: [{ type: "tool_use", id: "h1", name: "http_request", input: { url: "https://api.example.com/v1/users", method: "GET" } }],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
      textMsg("API returned user data."),
    ]);

    setDelegateConfig({ model: "test", client });
    const result = await runDelegate({ task: "check the API", mode: "explore" });

    expect(result.content).toContain("sources: 1 URL(s)");
    expect(result.content).toContain("https://api.example.com/v1/users");
  });

  it("tracks both web_fetch and http_request URLs together", async () => {
    mockRunner.mockResolvedValue({ content: "page content", is_error: false });

    const client = makeMockClient([
      {
        content: [
          { type: "tool_use", id: "w1", name: "web_fetch", input: { url: "https://docs.example.com" } },
          { type: "tool_use", id: "h1", name: "http_request", input: { url: "https://api.example.com/v1/status", method: "GET" } },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
      textMsg("Got docs and API status."),
    ]);

    setDelegateConfig({ model: "test", client });
    const result = await runDelegate({ task: "research API", mode: "explore" });

    expect(result.content).toContain("sources: 2 URL(s)");
    expect(result.content).toContain("https://docs.example.com");
    expect(result.content).toContain("https://api.example.com/v1/status");
  });

  it("does not track http_request without url param", async () => {
    mockRunner.mockResolvedValue({ content: "ok", is_error: false });

    const client = makeMockClient([
      {
        content: [{ type: "tool_use", id: "h1", name: "http_request", input: { method: "GET" } }],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
      textMsg("Done."),
    ]);

    setDelegateConfig({ model: "test", client });
    const result = await runDelegate({ task: "api test", mode: "explore" });

    expect(result.content).not.toContain("sources:");
  });

  it("preserves emoji in task preview without garbling", async () => {
    const events: Array<{ type: string; message?: string }> = [];
    const transport = {
      emit: (event: { type: string; message?: string }) => { events.push(event); },
    };

    const client = makeMockClient([textMsg("Done.")]);
    setDelegateConfig({ model: "test", client, transport: transport as any }); // eslint-disable-line @typescript-eslint/no-explicit-any

    // 65 codepoints (30 emoji + 35 ASCII) — triggers truncation at 57 codepoints
    const emojiTask = `${"🔍".repeat(30)} search for data analysis patterns`;
    await runDelegate({ task: emojiTask, mode: "explore" });

    const startEvent = events.find((e) => e.type === "status" && e.message?.includes("starting:"));
    expect(startEvent).toBeDefined();
    const preview = startEvent!.message!.split("starting: ")[1];
    // Preview should end with "..."
    expect(preview).toMatch(/\.\.\.$/);
    // Strip "..." and verify 57 intact codepoints (no split surrogates)
    const previewChars = [...preview.replace(/\.\.\.$/, "")];
    expect(previewChars).toHaveLength(57);
    // First 30 should be magnifying glass emoji (intact, not garbled)
    expect(previewChars.slice(0, 30).every((c) => c === "🔍")).toBe(true);
  });
});
