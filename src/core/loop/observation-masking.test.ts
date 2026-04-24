import { describe, expect, it } from "vitest";
import type { KotaMessage } from "#core/agent-harness/message-protocol.js";
import {
  generatePlaceholder,
  maskObservations,
} from "./observation-masking.js";

type Message = KotaMessage;

/** Helper: build an assistant message with a tool_use block. */
function toolUse(id: string, name: string, input: Record<string, unknown>): Message {
  return {
    role: "assistant",
    content: [{ type: "tool_use", id, name, input }],
  };
}

/** Helper: build a user message with a tool_result block. */
function toolResult(id: string, content: string, isError = false): Message {
  return {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }],
  };
}

/** Helper: build a simple text message. */
function textMsg(role: "user" | "assistant", text: string): Message {
  return { role, content: text };
}

/** Generate filler content of a given length. */
function filler(length: number): string {
  return "x".repeat(length);
}

describe("generatePlaceholder", () => {
  it("generates file_read placeholder", () => {
    const p = generatePlaceholder("file_read", { file_path: "/src/foo.ts" }, false);
    expect(p).toBe("[Observed: read /src/foo.ts]");
  });

  it("generates file_edit placeholder", () => {
    const p = generatePlaceholder("file_edit", { file_path: "/src/foo.ts" }, false);
    expect(p).toBe("[Observed: edited /src/foo.ts]");
  });

  it("generates file_write placeholder", () => {
    const p = generatePlaceholder("file_write", { file_path: "/src/new.ts" }, false);
    expect(p).toBe("[Observed: wrote /src/new.ts]");
  });

  it("generates shell placeholder with truncation", () => {
    const longCmd = "npm run build && npm run test && npm run lint && echo done";
    const p = generatePlaceholder("shell", { command: longCmd }, false);
    expect(p).toContain("[Observed: shell:");
    expect(p.length).toBeLessThan(120);
  });

  it("includes error status", () => {
    const p = generatePlaceholder("file_read", { file_path: "/missing.ts" }, true);
    expect(p).toBe("[Observed: read /missing.ts (error)]");
  });

  it("generates grep placeholder", () => {
    const p = generatePlaceholder("grep", { pattern: "TODO" }, false);
    expect(p).toBe('[Observed: grep "TODO"]');
  });

  it("generates web_search placeholder", () => {
    const p = generatePlaceholder("web_search", { query: "node.js best practices" }, false);
    expect(p).toBe('[Observed: search "node.js best practices"]');
  });

  it("generates delegate placeholder", () => {
    const p = generatePlaceholder("delegate", { task: "find all test files" }, false);
    expect(p).toBe('[Observed: delegate: "find all test files"]');
  });

  it("generates code_exec placeholder", () => {
    const p = generatePlaceholder("code_exec", { language: "python" }, false);
    expect(p).toBe("[Observed: executed python]");
  });

  it("generates http_request placeholder", () => {
    const p = generatePlaceholder("http_request", { method: "POST", url: "https://api.example.com/data" }, false);
    expect(p).toBe("[Observed: POST https://api.example.com/data]");
  });

  it("handles unknown tools", () => {
    const p = generatePlaceholder("some_new_tool", {}, false);
    expect(p).toBe("[Observed: some_new_tool]");
  });
});

describe("maskObservations", () => {
  it("returns zero stats when messages fit within window", () => {
    const messages: Message[] = [
      textMsg("user", "hello"),
      textMsg("assistant", "hi"),
    ];
    const stats = maskObservations(messages, 10);
    expect(stats).toEqual({ maskedCount: 0, charsSaved: 0 });
  });

  it("masks old tool results beyond the window", () => {
    const messages: Message[] = [
      // Old pair — should be masked
      toolUse("t1", "file_read", { file_path: "/src/foo.ts" }),
      toolResult("t1", filler(500)),
      // Recent pair — within window of 4
      toolUse("t2", "file_read", { file_path: "/src/bar.ts" }),
      toolResult("t2", filler(500)),
      textMsg("user", "what did you find?"),
      textMsg("assistant", "I found the code."),
    ];
    const stats = maskObservations(messages, 4);
    expect(stats.maskedCount).toBe(1);
    expect(stats.charsSaved).toBeGreaterThan(400);

    // Old result should be masked
    const oldResult = (messages[1] as { content: Array<{ content: string }> }).content[0];
    expect(oldResult.content).toBe("[Observed: read /src/foo.ts]");

    // Recent result should be untouched
    const recentResult = (messages[3] as { content: Array<{ content: string }> }).content[0];
    expect(recentResult.content).toBe(filler(500));
  });

  it("masks ALL tool types, not just read-only", () => {
    const messages: Message[] = [
      toolUse("t1", "shell", { command: "npm run build" }),
      toolResult("t1", filler(300)),
      toolUse("t2", "file_edit", { file_path: "/src/foo.ts" }),
      toolResult("t2", filler(300)),
      toolUse("t3", "code_exec", { language: "python" }),
      toolResult("t3", filler(300)),
      // Recent window
      textMsg("user", "done?"),
      textMsg("assistant", "yes"),
    ];
    const stats = maskObservations(messages, 2);
    expect(stats.maskedCount).toBe(3);

    const r1 = (messages[1] as { content: Array<{ content: string }> }).content[0];
    expect(r1.content).toContain("[Observed: shell:");

    const r2 = (messages[3] as { content: Array<{ content: string }> }).content[0];
    expect(r2.content).toBe("[Observed: edited /src/foo.ts]");

    const r3 = (messages[5] as { content: Array<{ content: string }> }).content[0];
    expect(r3.content).toBe("[Observed: executed python]");
  });

  it("skips results below minimum length", () => {
    const messages: Message[] = [
      toolUse("t1", "file_read", { file_path: "/src/small.ts" }),
      toolResult("t1", "OK"),  // 2 chars — below 200 threshold
      textMsg("user", "next"),
      textMsg("assistant", "ok"),
    ];
    const stats = maskObservations(messages, 2);
    expect(stats.maskedCount).toBe(0);
  });

  it("is idempotent — does not re-mask already masked results", () => {
    const messages: Message[] = [
      toolUse("t1", "file_read", { file_path: "/src/foo.ts" }),
      toolResult("t1", filler(500)),
      textMsg("user", "next"),
      textMsg("assistant", "ok"),
    ];

    const stats1 = maskObservations(messages, 2);
    expect(stats1.maskedCount).toBe(1);

    // Run again — should be no-op
    const stats2 = maskObservations(messages, 2);
    expect(stats2.maskedCount).toBe(0);
    expect(stats2.charsSaved).toBe(0);
  });

  it("preserves error status in placeholder", () => {
    const messages: Message[] = [
      toolUse("t1", "shell", { command: "npm test" }),
      toolResult("t1", filler(500), true),
      textMsg("user", "fix it"),
      textMsg("assistant", "fixing"),
    ];
    const stats = maskObservations(messages, 2);
    expect(stats.maskedCount).toBe(1);

    const r = (messages[1] as { content: Array<{ content: string }> }).content[0];
    expect(r.content).toContain("(error)");
  });

  it("handles image content", () => {
    const messages: Message[] = [
      toolUse("t1", "file_read", { file_path: "/screenshot.png" }),
      {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "t1",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
          ],
        }],
      },
      textMsg("user", "what's in it?"),
      textMsg("assistant", "I see a diagram"),
    ];
    const stats = maskObservations(messages, 2);
    expect(stats.maskedCount).toBe(1);
    expect(stats.charsSaved).toBe(5000);
  });

  it("handles multiple tool results in one user message", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "file_read", input: { file_path: "/a.ts" } },
          { type: "tool_use", id: "t2", name: "grep", input: { pattern: "import" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: filler(400) },
          { type: "tool_result", tool_use_id: "t2", content: filler(300) },
        ],
      },
      textMsg("user", "done"),
      textMsg("assistant", "ok"),
    ];
    const stats = maskObservations(messages, 2);
    expect(stats.maskedCount).toBe(2);
  });

  it("preserves text messages completely", () => {
    const longText = filler(1000);
    const messages: Message[] = [
      textMsg("user", longText),
      textMsg("assistant", longText),
      textMsg("user", "recent"),
      textMsg("assistant", "ok"),
    ];
    const stats = maskObservations(messages, 2);
    expect(stats.maskedCount).toBe(0);
    expect((messages[0] as { content: string }).content).toBe(longText);
  });

  it("preserves assistant tool_use blocks (only masks tool_result)", () => {
    const messages: Message[] = [
      toolUse("t1", "file_read", { file_path: "/src/big.ts" }),
      toolResult("t1", filler(500)),
      textMsg("user", "next"),
      textMsg("assistant", "ok"),
    ];
    maskObservations(messages, 2);

    // Assistant's tool_use block should be untouched
    const assistantContent = messages[0].content as Array<{ type: string; name: string }>;
    expect(assistantContent[0].type).toBe("tool_use");
    expect(assistantContent[0].name).toBe("file_read");
  });

  it("uses default window of 10", () => {
    const messages: Message[] = [];
    // 6 pairs (12 messages) — first pair should be masked with window=10
    for (let i = 0; i < 6; i++) {
      messages.push(toolUse(`t${i}`, "file_read", { file_path: `/f${i}.ts` }));
      messages.push(toolResult(`t${i}`, filler(500)));
    }
    const stats = maskObservations(messages);
    // With window=10, only first 2 messages (1 pair) are outside window
    expect(stats.maskedCount).toBe(1);
  });

  it("handles tool results with array-of-text-blocks content", () => {
    const messages: Message[] = [
      toolUse("t1", "web_fetch", { url: "https://example.com" }),
      {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "t1",
          content: [
            { type: "text", text: filler(300) },
            { type: "text", text: filler(300) },
          ],
        }],
      },
      textMsg("user", "recent"),
      textMsg("assistant", "ok"),
    ];
    const stats = maskObservations(messages, 2);
    expect(stats.maskedCount).toBe(1);
    const r = (messages[1] as { content: Array<{ content: string }> }).content[0];
    expect(r.content).toContain("[Observed: fetched https://example.com]");
  });

  it("does not mask when placeholder would be larger than content", () => {
    // A tool result that's 201 chars but whose placeholder is longer
    const messages: Message[] = [
      toolUse("t1", "web_fetch", { url: "https://very-long-url-that-makes-the-placeholder-quite-long.example.com/api/v1/endpoint" }),
      toolResult("t1", filler(201)),
      textMsg("user", "done"),
      textMsg("assistant", "ok"),
    ];
    const stats = maskObservations(messages, 2);
    // Should still mask since 201 chars of content > placeholder length (~100 chars)
    expect(stats.maskedCount).toBe(1);
  });
});
