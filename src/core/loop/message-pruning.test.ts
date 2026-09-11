import { describe, expect, it } from "vitest";
import type { KotaMessage, KotaToolResultBlock, KotaToolUseBlock } from "#core/agent-harness/message-protocol.js";
import { pruneMessages } from "./message-pruning.js";

const large = "line\n".repeat(400);
function observation(name: string, input: KotaToolUseBlock["input"], content: KotaToolResultBlock["content"] = large) {
  const call: KotaToolUseBlock = { type: "tool_use", id: "read", name, input };
  const result: KotaToolResultBlock = { type: "tool_result", tool_use_id: call.id, content };
  const messages: KotaMessage[] = [
    { role: "assistant", content: [call] }, { role: "user", content: [result] }, { role: "user", content: "Continue" },
  ];
  return { call, result, messages };
}
const options = { keepRecent: 1, minLength: 100 };

describe("read-only observation pruning", () => {
  it.each([
    ["file_read", { file_path: "auth.ts" }, "auth.ts", "Re-read"],
    ["grep", { pattern: "login" }, "login", "Re-grep"],
    ["glob", { pattern: "src/*.ts" }, "src/*.ts", "Re-glob"],
    ["web_fetch", { url: "https://example.com" }, "https://example.com", "Re-fetch"],
    ["web_search", { query: "token validation" }, "token validation", "Re-search"],
    ["delegate", { task: "inspect login" }, "inspect login", "Result pruned"],
    ["repo_map", {}, "repo map", "Re-run"],
  ] as const)("retains recovery context for %s", (name, input, subject, action) => {
    const { messages, result } = observation(name, input);
    const stats = pruneMessages(messages, options);
    expect(result.content).toContain(subject);
    expect(result.content).toContain(action);
    expect(stats).toEqual({ prunedCount: 1, charsSaved: large.length - result.content.length });
    const after = structuredClone(messages);
    expect(pruneMessages(messages, options)).toEqual({ prunedCount: 0, charsSaved: 0 });
    expect(messages).toEqual(after);
  });

  it.each(["shell", "process", "code_exec", "file_edit", "file_write", "multi_edit", "unknown"])(
    "preserves non-reproducible %s results", (name) => {
      const { messages } = observation(name, {});
      const before = structuredClone(messages);
      expect(pruneMessages(messages, options)).toEqual({ prunedCount: 0, charsSaved: 0 });
      expect(messages).toEqual(before);
    },
  );

  it.each(["error", "short", "recent", "orphan"])("preserves %s observations", (reason) => {
    const { messages, result } = observation("file_read", { path: "auth.ts" });
    if (reason === "error") result.is_error = true;
    if (reason === "short") result.content = [{ type: "text", text: "small" }];
    if (reason === "orphan") result.tool_use_id = "missing";
    const before = structuredClone(messages);
    expect(pruneMessages(messages, { ...options, keepRecent: reason === "recent" ? 2 : 1 }))
      .toEqual({ prunedCount: 0, charsSaved: 0 });
    expect(messages).toEqual(before);
  });

  it.each(["text", "image"])("replaces the entire old %s envelope and preserves the recent one", (kind) => {
    const { messages, result, call } = observation("file_read", { path: "auth.ts" }, [
      ...(kind === "image" ? [{ type: "image" as const, source: { type: "base64" as const, media_type: "image/png", data: "image-bytes" } }] : []),
      { type: "text", text: large.slice(0, 1000), _meta: { cache: "block-cache" } },
      { type: "text", text: large.slice(1000) },
      { type: "mcp_content", content: { type: "audio", data: "audio-bytes", mimeType: "audio/wav" } },
    ]);
    result.structuredContent = { private: "structured-payload" };
    result._meta = { cache: "result-cache" };
    messages[2] = { role: "user", content: [structuredClone(result)] };
    const retained = structuredClone(messages);
    expect(pruneMessages(messages, options).prunedCount).toBe(1);
    expect(result).toEqual({ type: "tool_result", tool_use_id: call.id, content: expect.stringContaining("auth.ts") });
    expect(result.content.length).toBeLessThan(150);
    expect(messages[0]).toEqual(retained[0]);
    expect(messages[2]).toEqual(retained[2]);
  });

  it("pairs batched results by id and changes only the eligible envelope", () => {
    const { messages, result, call } = observation("file_read", { path: "auth.ts" });
    const write: KotaToolUseBlock = { ...call, id: "write", name: "file_edit" };
    const written: KotaToolResultBlock = { ...result, tool_use_id: write.id };
    messages[0].content = [write, call];
    messages[1].content = [result, written];
    expect(pruneMessages(messages, options).prunedCount).toBe(1);
    expect(result.content).toContain("auth.ts");
    expect(written.content).toBe(large);
  });

  it("does not replace an observation with a larger summary", () => {
    const { messages } = observation("file_read", { path: "nested/".repeat(40) }, "x".repeat(100));
    const before = structuredClone(messages);
    expect(pruneMessages(messages, options)).toEqual({ prunedCount: 0, charsSaved: 0 });
    expect(messages).toEqual(before);
  });
});
