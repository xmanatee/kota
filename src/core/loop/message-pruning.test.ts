import { describe, expect, it } from "vitest";
import type {
  KotaMessage,
  KotaToolResultBlockContent,
} from "#core/agent-harness/message-protocol.js";
import { buildToolCallMap, generateSummary, pruneMessages } from "./message-pruning.js";

type Message = KotaMessage;

function toolUse(name: string, input: Record<string, unknown>, id: string): Message {
  return {
    role: "assistant",
    content: [{ type: "tool_use", id, name, input }],
  };
}

function toolResult(content: string, id: string, is_error = false): Message {
  return {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: id, content, is_error }],
  };
}

const LARGE_CONTENT = "x\n".repeat(1000); // 2000 chars

describe("buildToolCallMap", () => {
  it("extracts tool calls from assistant messages", () => {
    const messages: Message[] = [
      toolUse("file_read", { path: "src/foo.ts" }, "t1"),
      toolUse("shell", { command: "npm test" }, "t2"),
    ];
    const map = buildToolCallMap(messages);
    expect(map.size).toBe(2);
    expect(map.get("t1")).toEqual({ name: "file_read", input: { path: "src/foo.ts" } });
    expect(map.get("t2")).toEqual({ name: "shell", input: { command: "npm test" } });
  });

  it("ignores user messages and string content", () => {
    const messages: Message[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ];
    const map = buildToolCallMap(messages);
    expect(map.size).toBe(0);
  });
});

describe("generateSummary", () => {
  it("generates file_read summary with path and line count", () => {
    const summary = generateSummary("file_read", { path: "src/foo.ts" }, "line1\nline2\nline3");
    expect(summary).toContain("src/foo.ts");
    expect(summary).toContain("3 lines");
    expect(summary).toContain("Re-read if needed");
  });

  it("generates grep summary with pattern", () => {
    const summary = generateSummary("grep", { pattern: "TODO" }, "match1\nmatch2");
    expect(summary).toContain("TODO");
    expect(summary).toContain("Re-grep if needed");
  });

  it("generates glob summary with pattern", () => {
    const summary = generateSummary("glob", { pattern: "**/*.ts" }, "f1\nf2\nf3");
    expect(summary).toContain("**/*.ts");
    expect(summary).toContain("3 results");
  });

  it("generates web_fetch summary with URL", () => {
    const summary = generateSummary("web_fetch", { url: "https://example.com" }, "content");
    expect(summary).toContain("https://example.com");
    expect(summary).toContain("Re-fetch if needed");
  });

  it("generates web_search summary with query", () => {
    const summary = generateSummary("web_search", { query: "node.js streams" }, "results");
    expect(summary).toContain("node.js streams");
    expect(summary).toContain("Re-search if needed");
  });

  it("generates delegate summary with task", () => {
    const summary = generateSummary("delegate", { task: "find auth module" }, "long result");
    expect(summary).toContain("find auth module");
    expect(summary).toContain("Result pruned");
  });

  it("generates repo_map summary", () => {
    const summary = generateSummary("repo_map", {}, "sym1\nsym2\nsym3\nsym4");
    expect(summary).toContain("4 lines");
    expect(summary).toContain("Re-run if needed");
  });

  it("truncates long patterns and URLs", () => {
    const longPattern = "a".repeat(100);
    const summary = generateSummary("grep", { pattern: longPattern }, "match");
    expect(summary.length).toBeLessThan(150);
  });

  it("generates default fallback summary for unknown tool", () => {
    const summary = generateSummary("custom_tool", {}, "line1\nline2");
    expect(summary).toContain("custom_tool");
    expect(summary).toContain("2 lines");
    expect(summary).toContain("Re-run if needed");
  });
});

describe("pruneMessages", () => {
  it("returns zero stats when fewer messages than keepRecent", () => {
    const messages: Message[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    const stats = pruneMessages(messages, { keepRecent: 5 });
    expect(stats.prunedCount).toBe(0);
    expect(stats.charsSaved).toBe(0);
  });

  it("prunes large file_read results from old messages", () => {
    const messages: Message[] = [
      toolUse("file_read", { path: "src/big.ts" }, "t1"),
      toolResult(LARGE_CONTENT, "t1"),
      // Padding to push the above beyond keepRecent
      ...Array.from({ length: 6 }, (_, i) => ({
        role: "user" as const,
        content: `msg-${i}`,
      })),
    ];
    const stats = pruneMessages(messages, { keepRecent: 4, minLength: 100 });
    expect(stats.prunedCount).toBe(1);
    expect(stats.charsSaved).toBeGreaterThan(1000);

    // Verify the content was replaced with a summary
    const resultMsg = messages[1] as { role: string; content: Array<{ content: string }> };
    expect(resultMsg.content[0].content).toContain("Previously read");
    expect(resultMsg.content[0].content).toContain("src/big.ts");
  });

  it("does not prune error results", () => {
    const messages: Message[] = [
      toolUse("file_read", { path: "missing.ts" }, "t1"),
      toolResult(LARGE_CONTENT, "t1", true),
      ...Array.from({ length: 6 }, (_, i) => ({
        role: "user" as const,
        content: `msg-${i}`,
      })),
    ];
    const stats = pruneMessages(messages, { keepRecent: 4, minLength: 100 });
    expect(stats.prunedCount).toBe(0);
  });

  it("does not prune non-pruneable tools (shell, process, code_exec, file_edit)", () => {
    const messages: Message[] = [
      toolUse("shell", { command: "npm test" }, "t1"),
      toolResult(LARGE_CONTENT, "t1"),
      toolUse("process", { action: "start", command: "pnpm dev" }, "t2"),
      toolResult(LARGE_CONTENT, "t2"),
      toolUse("code_exec", { language: "python" }, "t3"),
      toolResult(LARGE_CONTENT, "t3"),
      toolUse("file_edit", { file_path: "src/foo.ts" }, "t4"),
      toolResult(LARGE_CONTENT, "t4"),
      ...Array.from({ length: 6 }, (_, i) => ({
        role: "user" as const,
        content: `msg-${i}`,
      })),
    ];
    const stats = pruneMessages(messages, { keepRecent: 4, minLength: 100 });
    expect(stats.prunedCount).toBe(0);
  });

  it("does not prune small results", () => {
    const messages: Message[] = [
      toolUse("file_read", { path: "small.ts" }, "t1"),
      toolResult("short content", "t1"),
      ...Array.from({ length: 6 }, (_, i) => ({
        role: "user" as const,
        content: `msg-${i}`,
      })),
    ];
    const stats = pruneMessages(messages, { keepRecent: 4, minLength: 100 });
    expect(stats.prunedCount).toBe(0);
  });

  it("does not prune recent messages within keepRecent window", () => {
    const messages: Message[] = [
      ...Array.from({ length: 4 }, (_, i) => ({
        role: "user" as const,
        content: `old-${i}`,
      })),
      toolUse("file_read", { path: "recent.ts" }, "t1"),
      toolResult(LARGE_CONTENT, "t1"),
    ];
    const stats = pruneMessages(messages, { keepRecent: 4, minLength: 100 });
    expect(stats.prunedCount).toBe(0);
  });

  it("prunes multiple results and reports correct stats", () => {
    const messages: Message[] = [
      toolUse("file_read", { path: "a.ts" }, "t1"),
      toolResult(LARGE_CONTENT, "t1"),
      toolUse("grep", { pattern: "TODO" }, "t2"),
      toolResult(LARGE_CONTENT, "t2"),
      toolUse("web_fetch", { url: "https://docs.example.com" }, "t3"),
      toolResult(LARGE_CONTENT, "t3"),
      ...Array.from({ length: 6 }, (_, i) => ({
        role: "user" as const,
        content: `msg-${i}`,
      })),
    ];
    const stats = pruneMessages(messages, { keepRecent: 4, minLength: 100 });
    expect(stats.prunedCount).toBe(3);
    expect(stats.charsSaved).toBeGreaterThan(3000);
  });

  it("is idempotent — second call prunes nothing", () => {
    const messages: Message[] = [
      toolUse("file_read", { path: "a.ts" }, "t1"),
      toolResult(LARGE_CONTENT, "t1"),
      ...Array.from({ length: 6 }, (_, i) => ({
        role: "user" as const,
        content: `msg-${i}`,
      })),
    ];
    const opts = { keepRecent: 4, minLength: 100 };
    const first = pruneMessages(messages, opts);
    expect(first.prunedCount).toBe(1);

    const second = pruneMessages(messages, opts);
    expect(second.prunedCount).toBe(0);
    expect(second.charsSaved).toBe(0);
  });

  it("handles messages with multiple tool results in one user message", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "file_read", input: { path: "a.ts" } },
          { type: "tool_use", id: "t2", name: "file_read", input: { path: "b.ts" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: LARGE_CONTENT },
          { type: "tool_result", tool_use_id: "t2", content: LARGE_CONTENT },
        ],
      },
      ...Array.from({ length: 6 }, (_, i) => ({
        role: "user" as const,
        content: `msg-${i}`,
      })),
    ];
    const stats = pruneMessages(messages, { keepRecent: 4, minLength: 100 });
    expect(stats.prunedCount).toBe(2);
  });

  it("prunes image-bearing results regardless of size", () => {
    const imageContent: KotaToolResultBlockContent = [
      { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
    ];
    const messages: Message[] = [
      toolUse("file_read", { path: "screenshot.png" }, "t1"),
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: imageContent }],
      },
      ...Array.from({ length: 6 }, (_, i) => ({
        role: "user" as const,
        content: `msg-${i}`,
      })),
    ];
    const stats = pruneMessages(messages, { keepRecent: 4, minLength: 100 });
    expect(stats.prunedCount).toBe(1);
    expect(stats.charsSaved).toBeGreaterThan(0);
    const resultMsg = messages[1] as { role: string; content: Array<{ content: string }> };
    expect(typeof resultMsg.content[0].content).toBe("string");
    expect(resultMsg.content[0].content).toContain("image");
  });

  it("handles mixed pruneable and non-pruneable in same message", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "file_read", input: { path: "a.ts" } },
          { type: "tool_use", id: "t2", name: "shell", input: { command: "npm test" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: LARGE_CONTENT },
          { type: "tool_result", tool_use_id: "t2", content: LARGE_CONTENT },
        ],
      },
      ...Array.from({ length: 6 }, (_, i) => ({
        role: "user" as const,
        content: `msg-${i}`,
      })),
    ];
    const stats = pruneMessages(messages, { keepRecent: 4, minLength: 100 });
    expect(stats.prunedCount).toBe(1); // Only file_read, not shell
  });
});
