import { describe, expect, it, vi } from "vitest";
import type { KotaMessage, KotaModelResponse } from "#core/agent-harness/message-protocol.js";
import type { MessageCreateParams, ModelClient } from "#core/model/model-client.js";
import { Context } from "./context.js";

describe("Context prune and compact composition", () => {
  it.each(["success", "provider failure"])("keeps action, image and failure evidence through %s", async (outcome) => {
    const messages: KotaMessage[] = [
      { role: "user", content: "Repair login" },
      { role: "assistant", content: [
        { type: "tool_use", id: "read", name: "file_read", input: { path: "auth.ts" } },
        { type: "tool_use", id: "edit", name: "file_edit", input: { file_path: "auth.ts" } },
        { type: "tool_use", id: "test", name: "shell", input: { command: "pnpm test" } },
        { type: "tool_use", id: "image", name: "file_read", input: { path: "diagram.png" } },
      ] },
      { role: "user", content: [
        { type: "tool_result", tool_use_id: "read", content: "original-file-bytes".repeat(200) },
        { type: "tool_result", tool_use_id: "edit", content: "Edit applied" },
        { type: "tool_result", tool_use_id: "test", content: "login assertion failed", is_error: true },
        { type: "tool_result", tool_use_id: "image", content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: "encoded-image-bytes" } },
        ], structuredContent: { hidden: "image-metadata" } },
      ] },
      { role: "assistant", content: "Investigating" },
      ...Array.from({ length: 11 }, (_, i): KotaMessage[] => [
        { role: "user", content: `follow-up-${i}` }, { role: "assistant", content: `reply-${i}` },
      ]).flat(),
    ];
    const ctx = new Context("Base");
    ctx.restoreFrom(messages, 0, 120000);
    const before = structuredClone(messages);
    expect(ctx.maybePrune().prunedCount).toBe(2);
    expect(messages.slice(-20)).toEqual(before.slice(-20));
    expect(JSON.stringify(messages)).not.toMatch(/original-file-bytes|encoded-image-bytes|image-metadata/);
    const create = vi.fn(async (params: MessageCreateParams): Promise<KotaModelResponse> => {
      if (outcome === "provider failure") throw new Error("provider offline");
      return {
        id: "summary", role: "assistant", model: params.model, stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "Continue repairing login" }],
      };
    });
    const client: ModelClient = { messages: { create, stream() { throw new Error("unexpected streaming request"); } } };
    await ctx.compact(client, "selected-model");
    expect(create).toHaveBeenCalledOnce();
    const prompt = String(create.mock.calls[0][0].messages[0].content);
    expect(prompt).toContain("diagram.png");
    expect(prompt).toContain("login assertion failed");
    expect(prompt).toContain("Edit applied");
    const after = ctx.getMessages();
    expect(after.slice(2)).toEqual(before.slice(-10));
    expect(after[0].content).toContain("Files modified: auth.ts");
    expect(after[0].content).toContain("Commands run: pnpm test");
    expect(after[0].content).toContain("login assertion failed");
    expect(after[0].content).toContain(outcome === "success" ? "Continue repairing login" : "diagram.png");
    expect(ctx.getStats().compactions).toBe(1);
  });
});
