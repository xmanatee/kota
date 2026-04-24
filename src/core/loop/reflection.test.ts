import { describe, expect, it } from "vitest";
import type { KotaMessage } from "#core/agent-harness/message-protocol.js";
import {
  analyzeToolUsage,
  buildReflectionPrompt,
  getLastAssistantText,
  reflectionIndicatesComplete,
  shouldReflect,
} from "./reflection.js";

type Message = KotaMessage;

// --- helpers ---

function userMsg(text: string): Message {
  return { role: "user", content: text };
}

function assistantMsg(text: string): Message {
  return { role: "assistant", content: text };
}

function toolUseMsg(name: string, input: Record<string, unknown> = {}, id = "t1"): Message {
  return {
    role: "assistant",
    content: [{ type: "tool_use", id, name, input }],
  };
}

function toolResultMsg(id = "t1", content = "ok", isError = false): Message {
  return {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }],
  };
}

// --- analyzeToolUsage ---

describe("analyzeToolUsage", () => {
  it("returns empty summary for no messages", () => {
    const result = analyzeToolUsage([]);
    expect(result).toEqual({
      editedFiles: false,
      didResearch: false,
      didCompute: false,
      ranVerification: false,
      toolCallCount: 0,
    });
  });

  it("detects file editing tools", () => {
    const messages: Message[] = [
      toolUseMsg("file_edit", { path: "foo.ts" }),
      toolResultMsg(),
    ];
    const result = analyzeToolUsage(messages);
    expect(result.editedFiles).toBe(true);
    expect(result.toolCallCount).toBe(1);
  });

  it("detects multi_edit as file editing", () => {
    const messages: Message[] = [
      toolUseMsg("multi_edit", { edits: [{ file_path: "a.ts" }] }),
      toolResultMsg(),
    ];
    expect(analyzeToolUsage(messages).editedFiles).toBe(true);
  });

  it("detects find_replace as file editing", () => {
    const messages: Message[] = [
      toolUseMsg("find_replace", { pattern: "old", replacement: "new" }),
      toolResultMsg(),
    ];
    expect(analyzeToolUsage(messages).editedFiles).toBe(true);
  });

  it("detects research tools", () => {
    const messages: Message[] = [
      toolUseMsg("web_search", { query: "test" }),
      toolResultMsg(),
    ];
    const result = analyzeToolUsage(messages);
    expect(result.didResearch).toBe(true);
  });

  it("detects http_request as research", () => {
    const messages: Message[] = [
      toolUseMsg("http_request", { url: "https://example.com" }),
      toolResultMsg(),
    ];
    expect(analyzeToolUsage(messages).didResearch).toBe(true);
  });

  it("detects compute tools", () => {
    const messages: Message[] = [
      toolUseMsg("code_exec", { language: "python", code: "1+1" }),
      toolResultMsg(),
    ];
    expect(analyzeToolUsage(messages).didCompute).toBe(true);
  });

  it("detects notebook as compute", () => {
    const messages: Message[] = [
      toolUseMsg("notebook", { action: "run" }),
      toolResultMsg(),
    ];
    expect(analyzeToolUsage(messages).didCompute).toBe(true);
  });

  it("detects verification via shell commands", () => {
    const messages: Message[] = [
      toolUseMsg("shell", { command: "npm test" }),
      toolResultMsg(),
    ];
    expect(analyzeToolUsage(messages).ranVerification).toBe(true);
  });

  it("detects typecheck as verification", () => {
    const messages: Message[] = [
      toolUseMsg("shell", { command: "npm run typecheck" }),
      toolResultMsg(),
    ];
    expect(analyzeToolUsage(messages).ranVerification).toBe(true);
  });

  it("does not flag non-verify shell as verification", () => {
    const messages: Message[] = [
      toolUseMsg("shell", { command: "ls -la" }),
      toolResultMsg(),
    ];
    expect(analyzeToolUsage(messages).ranVerification).toBe(false);
  });

  it("counts multiple tool calls", () => {
    const messages: Message[] = [
      toolUseMsg("file_read", { path: "a.ts" }, "t1"),
      toolResultMsg("t1"),
      toolUseMsg("file_edit", { path: "a.ts" }, "t2"),
      toolResultMsg("t2"),
      toolUseMsg("shell", { command: "npm test" }, "t3"),
      toolResultMsg("t3"),
    ];
    const result = analyzeToolUsage(messages);
    expect(result.toolCallCount).toBe(3);
    expect(result.editedFiles).toBe(true);
    expect(result.ranVerification).toBe(true);
  });

  it("handles string content messages gracefully", () => {
    const messages: Message[] = [
      userMsg("hello"),
      assistantMsg("hi there"),
    ];
    const result = analyzeToolUsage(messages);
    expect(result.toolCallCount).toBe(0);
  });
});

// --- getLastAssistantText ---

describe("getLastAssistantText", () => {
  it("returns empty for no messages", () => {
    expect(getLastAssistantText([])).toBe("");
  });

  it("extracts text from string content", () => {
    const messages: Message[] = [
      userMsg("hello"),
      assistantMsg("world"),
    ];
    expect(getLastAssistantText(messages)).toBe("world");
  });

  it("extracts text from array content", () => {
    const messages: Message[] = [
      userMsg("hello"),
      {
        role: "assistant",
        content: [
          { type: "text", text: "first part" },
          { type: "text", text: "second part" },
        ],
      },
    ];
    expect(getLastAssistantText(messages)).toBe("first part\nsecond part");
  });

  it("returns the LAST assistant message", () => {
    const messages: Message[] = [
      assistantMsg("old"),
      userMsg("question"),
      assistantMsg("new"),
    ];
    expect(getLastAssistantText(messages)).toBe("new");
  });

  it("skips tool_use blocks in content", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "shell", input: {} },
          { type: "text", text: "done" },
        ],
      },
    ];
    expect(getLastAssistantText(messages)).toBe("done");
  });
});

// --- shouldReflect ---

describe("shouldReflect", () => {
  it("returns false for short responses", () => {
    const messages: Message[] = [
      userMsg("hello"),
      toolUseMsg("shell", { command: "ls" }, "t1"),
      toolResultMsg("t1"),
      toolUseMsg("shell", { command: "pwd" }, "t2"),
      toolResultMsg("t2"),
      toolUseMsg("shell", { command: "cat f" }, "t3"),
      toolResultMsg("t3"),
      assistantMsg("short"),
    ];
    expect(shouldReflect(messages, "short")).toBe(false);
  });

  it("returns false for few tool calls", () => {
    const longResponse = "a".repeat(300);
    const messages: Message[] = [
      userMsg("do something"),
      toolUseMsg("shell", { command: "ls" }),
      toolResultMsg(),
      assistantMsg(longResponse),
    ];
    expect(shouldReflect(messages, longResponse)).toBe(false);
  });

  it("returns true for substantive response with sufficient tool use", () => {
    const longResponse = "a".repeat(300);
    const messages: Message[] = [
      userMsg("build feature X"),
      toolUseMsg("file_read", { path: "a.ts" }, "t1"),
      toolResultMsg("t1"),
      toolUseMsg("file_edit", { path: "a.ts" }, "t2"),
      toolResultMsg("t2"),
      toolUseMsg("shell", { command: "npm test" }, "t3"),
      toolResultMsg("t3"),
      assistantMsg(longResponse),
    ];
    expect(shouldReflect(messages, longResponse)).toBe(true);
  });

  it("returns false for empty response", () => {
    const messages: Message[] = [
      userMsg("hello"),
      toolUseMsg("shell", { command: "ls" }, "t1"),
      toolResultMsg("t1"),
      toolUseMsg("shell", { command: "pwd" }, "t2"),
      toolResultMsg("t2"),
      toolUseMsg("shell", { command: "cat" }, "t3"),
      toolResultMsg("t3"),
    ];
    expect(shouldReflect(messages, "")).toBe(false);
  });
});

// --- buildReflectionPrompt ---

describe("buildReflectionPrompt", () => {
  it("includes completeness and correctness criteria", () => {
    const messages: Message[] = [
      userMsg("do something"),
      assistantMsg("done"),
    ];
    const prompt = buildReflectionPrompt(messages);
    expect(prompt).toContain("Completeness");
    expect(prompt).toContain("Correctness");
  });

  it("includes verification criterion when files were edited", () => {
    const messages: Message[] = [
      userMsg("edit a file"),
      toolUseMsg("file_edit", { path: "a.ts" }),
      toolResultMsg(),
    ];
    const prompt = buildReflectionPrompt(messages);
    expect(prompt).toContain("Verification");
    expect(prompt).toContain("Side effects");
  });

  it("includes sources criterion when research tools were used", () => {
    const messages: Message[] = [
      userMsg("research X"),
      toolUseMsg("web_search", { query: "X" }),
      toolResultMsg(),
    ];
    const prompt = buildReflectionPrompt(messages);
    expect(prompt).toContain("Sources");
  });

  it("includes methodology criterion when compute tools were used", () => {
    const messages: Message[] = [
      userMsg("analyze data"),
      toolUseMsg("code_exec", { code: "1+1" }),
      toolResultMsg(),
    ];
    const prompt = buildReflectionPrompt(messages);
    expect(prompt).toContain("Methodology");
  });

  it("always includes quality criterion", () => {
    const messages: Message[] = [
      userMsg("do something"),
    ];
    const prompt = buildReflectionPrompt(messages);
    expect(prompt).toContain("Quality");
  });

  it("includes user goal in the prompt", () => {
    const messages: Message[] = [
      userMsg("Build a REST API for user authentication"),
      assistantMsg("done"),
    ];
    const prompt = buildReflectionPrompt(messages);
    expect(prompt).toContain("Build a REST API for user authentication");
  });

  it("truncates long user goals", () => {
    const longGoal = "x".repeat(500);
    const messages: Message[] = [
      userMsg(longGoal),
    ];
    const prompt = buildReflectionPrompt(messages);
    expect(prompt).toContain("...");
    expect(prompt.length).toBeLessThan(longGoal.length + 500);
  });

  it("includes action instruction", () => {
    const messages: Message[] = [
      userMsg("do X"),
    ];
    const prompt = buildReflectionPrompt(messages);
    expect(prompt).toContain("take action now");
    expect(prompt).toContain("confirm briefly");
  });
});

// --- reflectionIndicatesComplete ---

describe("reflectionIndicatesComplete", () => {
  it("returns false when tool calls were made", () => {
    expect(reflectionIndicatesComplete(true, "All criteria met.")).toBe(false);
  });

  it("returns true for clean confirmation text", () => {
    expect(reflectionIndicatesComplete(
      false,
      "All criteria are met. The response fully addresses the user's request.",
    )).toBe(true);
  });

  it("returns false when multiple issues are identified", () => {
    expect(reflectionIndicatesComplete(
      false,
      "Criterion 3 is not met. The verification was missing. I should run tests. I also forgot to check the build.",
    )).toBe(false);
  });

  it("returns true for minor mentions that look like false positives", () => {
    // 1-2 pattern matches could be false positives (model explaining what it already did)
    expect(reflectionIndicatesComplete(
      false,
      "The response is complete. Previously I needed to fix a bug, but that's been done.",
    )).toBe(true);
  });

  it("returns true for empty response text", () => {
    expect(reflectionIndicatesComplete(false, "")).toBe(true);
  });
});
