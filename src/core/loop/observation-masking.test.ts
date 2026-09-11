import { describe, expect, it } from "vitest";
import type { KotaMessage, KotaToolResultBlock, KotaToolUseBlock } from "#core/agent-harness/message-protocol.js";
import { maskObservations } from "./observation-masking.js";

function observation(name: string, input: KotaToolUseBlock["input"], content: KotaToolResultBlock["content"] = "x".repeat(500)) {
  const result: KotaToolResultBlock = { type: "tool_result", tool_use_id: "call", content };
  const messages: KotaMessage[] = [
    { role: "assistant", content: [{ type: "text", text: "Keep the plan" }, { type: "tool_use", id: "call", name, input }] },
    { role: "user", content: [result] }, { role: "assistant", content: "Continue" },
  ];
  return { messages, result };
}

describe("observation masking", () => {
  it.each([
    ["file_read", { path: "auth.ts" }, "read auth.ts"],
    ["file_edit", { file_path: "auth.ts" }, "edited auth.ts"],
    ["file_write", { file_path: "new.ts" }, "wrote new.ts"],
    ["shell", { command: "pnpm test" }, "shell: pnpm test"],
    ["process", { action: "start", command: "pnpm dev" }, "process: start pnpm dev"],
    ["code_exec", { language: "python" }, "executed python"],
    ["http_request", { method: "POST", url: "https://example.com" }, "POST https://example.com"],
    ["grep", { pattern: "token" }, 'grep "token"'],
    ["web_search", { query: "validation" }, 'search "validation"'],
    ["delegate", { task: "inspect login" }, 'delegate: "inspect login"'],
    ["new_tool", {}, "new_tool"],
  ] as const)("keeps %s action and error identity", (name, input, label) => {
    const { messages, result } = observation(name, input);
    result.is_error = true;
    const assistant = structuredClone(messages[0]);
    const placeholder = `[Observed: ${label} (error)]`;
    expect(maskObservations(messages, 1)).toEqual({ maskedCount: 1, charsSaved: 500 - placeholder.length });
    expect(result).toEqual({ type: "tool_result", tool_use_id: "call", content: placeholder, is_error: true });
    expect(messages[0]).toEqual(assistant);
    const after = structuredClone(messages);
    expect(maskObservations(messages, 1)).toEqual({ maskedCount: 0, charsSaved: 0 });
    expect(messages).toEqual(after);
  });

  it.each(["short", "recent", "larger placeholder", "already masked"])("preserves %s results", (reason) => {
    const { messages, result } = observation("file_read", { path: "long/".repeat(60) });
    if (reason === "short") result.content = "OK";
    if (reason === "larger placeholder") result.content = "x".repeat(201);
    if (reason === "already masked") result.content = `[Observed: ${"x".repeat(400)}]`;
    const before = structuredClone(messages);
    expect(maskObservations(messages, reason === "recent" ? 2 : 1)).toEqual({ maskedCount: 0, charsSaved: 0 });
    expect(messages).toEqual(before);
  });

  it.each(["text", "image"])("removes old %s metadata while keeping recent rich results intact", (kind) => {
    const { messages, result } = observation("web_fetch", { url: "https://example.com" }, [
      ...(kind === "image" ? [{ type: "image" as const, source: { type: "base64" as const, media_type: "image/png", data: "image-bytes" } }] : []),
      { type: "text", text: "x".repeat(300), _meta: { cache: "block-cache" } },
      { type: "text", text: "y".repeat(300) },
      { type: "mcp_content", content: { type: "audio", data: "audio-bytes", mimeType: "audio/wav" } },
    ]);
    result.structuredContent = { private: "structured-payload" };
    result._meta = { cache: "result-cache" };
    messages[2] = { role: "user", content: [structuredClone(result)] };
    const recent = structuredClone(messages[2]);
    expect(maskObservations(messages, 1).maskedCount).toBe(1);
    expect(result).toEqual({ type: "tool_result", tool_use_id: "call", content: "[Observed: fetched https://example.com]" });
    expect(messages[2]).toEqual(recent);
  });

  it("pairs batched results and masks unmatched observations without erasing ordinary text", () => {
    const { messages, result } = observation("file_read", { file_path: "auth.ts" });
    const orphan: KotaToolResultBlock = { ...result, tool_use_id: "unmatched" };
    messages[1].content = [{ type: "text", text: "retain this request" }, orphan, result];
    expect(maskObservations(messages, 1).maskedCount).toBe(2);
    expect(messages[1].content).toEqual([
      { type: "text", text: "retain this request" },
      { ...orphan, content: "[Observed: tool result]" }, { ...result, content: "[Observed: read auth.ts]" },
    ]);
  });

  it("rejects malformed known-tool input through the masking boundary", () => {
    const { messages } = observation("file_read", null);
    expect(() => maskObservations(messages, 1)).toThrow("Tool observation input must be an object");
  });
});
