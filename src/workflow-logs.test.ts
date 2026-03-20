import { describe, expect, it } from "vitest";
import { formatAgentMessage, formatContentBlock, truncateContent } from "./workflow-logs.js";

describe("truncateContent", () => {
  it("returns short text unchanged", () => {
    expect(truncateContent("hello world", 200)).toBe("hello world");
  });

  it("truncates long text with indicator", () => {
    const long = "a".repeat(300);
    const result = truncateContent(long, 200);
    expect(result).toContain("… [+100 chars]");
    expect(result.startsWith("a".repeat(200))).toBe(true);
  });

  it("trims leading/trailing whitespace before measuring", () => {
    expect(truncateContent("  hello  ", 200)).toBe("hello");
  });
});

describe("formatContentBlock", () => {
  it("formats text block", () => {
    expect(formatContentBlock({ type: "text", text: "Hello!" })).toBe("Hello!");
  });

  it("returns null for thinking block", () => {
    expect(formatContentBlock({ type: "thinking", thinking: "hidden" })).toBeNull();
  });

  it("formats tool_use block with name and input", () => {
    const result = formatContentBlock({ type: "tool_use", name: "Bash", input: { command: "ls" } });
    expect(result).toBe('[tool: Bash] {"command":"ls"}');
  });

  it("formats tool_result block", () => {
    const result = formatContentBlock({ type: "tool_result", content: "output text" });
    expect(result).toBe("[tool result] output text");
  });

  it("truncates long tool input", () => {
    const long = "x".repeat(300);
    const result = formatContentBlock({ type: "tool_use", name: "Read", input: long }, 50);
    expect(result).toContain("… [+");
    expect(result?.startsWith("[tool: Read]")).toBe(true);
  });
});

describe("formatAgentMessage", () => {
  it("formats assistant message with text content", () => {
    const msg = {
      type: "assistant" as const,
      message: {
        content: [{ type: "text", text: "I will help you." }],
      },
    };
    const lines = formatAgentMessage(msg);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("[assistant] I will help you.");
  });

  it("skips thinking blocks in assistant message", () => {
    const msg = {
      type: "assistant" as const,
      message: {
        content: [
          { type: "thinking", thinking: "internal thoughts" },
          { type: "text", text: "Hello" },
        ],
      },
    };
    const lines = formatAgentMessage(msg);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Hello");
  });

  it("formats result message with cost and turns", () => {
    const msg = {
      type: "result" as const,
      subtype: "success",
      total_cost_usd: 0.5,
      num_turns: 10,
      result: "Done.",
    };
    const lines = formatAgentMessage(msg);
    expect(lines[0]).toContain("success");
    expect(lines[0]).toContain("turns=10");
    expect(lines[0]).toContain("cost=$0.5000");
    expect(lines[1]).toContain("Done.");
  });

  it("returns empty array for system message", () => {
    const msg = { type: "system", subtype: "init" };
    expect(formatAgentMessage(msg as never)).toHaveLength(0);
  });

  it("formats user message with tool_result", () => {
    const msg = {
      type: "user",
      message: {
        content: [{ type: "tool_result", content: "file contents" }],
      },
    };
    expect(formatAgentMessage(msg as never)[0]).toBe("[user]      [tool result] file contents");
  });
});
