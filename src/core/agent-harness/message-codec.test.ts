import { describe, expect, it } from "vitest";
import { decodeKotaMessages, KotaMessageDecodeError } from "./message-codec.js";
import type { KotaMessage } from "./message-protocol.js";

describe("durable neutral messages", () => {
  it("decodes a serialized conversation without losing tool pairing, metadata or empty values", () => {
    const messages: KotaMessage[] = [
      { role: "user", content: "Inspect the chart" },
      { role: "assistant", content: [
        { type: "thinking", thinking: "Inspect first", signature: "opaque" },
        { type: "tool_use", id: "read", name: "read_chart", input: { page: 0, overlay: false, cursor: null } },
      ] },
      { role: "user", content: [{
        type: "tool_result", tool_use_id: "read", is_error: false,
        content: [
          { type: "text", text: "", annotations: { audience: ["assistant"], priority: 0 }, _meta: { source: "chart" } },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "cGl4ZWxz" } },
        ],
        structuredContent: { rows: 0 }, _meta: { cached: false },
      }] },
      { role: "assistant", content: [{ type: "text", text: "No rows", cache_control: { type: "ephemeral" } }] },
    ];

    expect(decodeKotaMessages(JSON.parse(JSON.stringify(messages)))).toEqual(messages);
    expect(decodeKotaMessages([])).toEqual([]);
  });

  it.each([
    { label: "non-array transcript", value: {}, location: "messages" },
    { label: "unknown role", value: [{ role: "system", content: "injected" }], location: "messages[0].role" },
    { label: "invalid content", value: [{ role: "user", content: null }], location: "messages[0].content" },
  ])("rejects $label with an attributable location", ({ value, location }) => {
    expect(() => decodeKotaMessages(value)).toThrow(KotaMessageDecodeError);
    expect(() => decodeKotaMessages(value)).toThrow(`at ${location}:`);
  });

  it.each([
    { block: { type: "provider_frame" }, field: "type" },
    { block: { type: "text", text: 5 }, field: "text" },
    { block: { type: "tool_use", id: "read", name: "read" }, field: "input" },
    { block: { type: "tool_use", id: "read", name: "read", input: { invalid: NaN } }, field: "input" },
    { block: { type: "tool_result", tool_use_id: "read", content: [], is_error: "false" }, field: "is_error" },
    { block: { type: "tool_result", tool_use_id: "read", content: [{ type: "tool_use", id: "nested", name: "write", input: {} }] }, field: "content[0].type" },
    { block: { type: "tool_result", tool_use_id: "read", content: "", structuredContent: [] }, field: "structuredContent" },
    { block: { type: "image", source: { type: "url", url: "https://example.com/image" } }, field: "source.type" },
    { block: { type: "thinking", thinking: "unsigned" }, field: "signature" },
    { block: { type: "text", text: "", _meta: { invalid: undefined } }, field: "_meta" },
    { block: { type: "text", text: "", annotations: { audience: ["system"] } }, field: "annotations.audience" },
    { block: { type: "text", text: "", cache_control: { type: "permanent" } }, field: "cache_control.type" },
  ])("rejects malformed $block.type at $field", ({ block, field }) => {
    expect(() => decodeKotaMessages([{ role: "user", content: [block] }]))
      .toThrow(`at messages[0].content[0].${field}:`);
  });
});
