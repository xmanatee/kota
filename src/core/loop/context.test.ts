import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaMessage, KotaModelResponse, KotaToolResultBlock } from "#core/agent-harness/message-protocol.js";
import type { MessageCreateParams, ModelClient } from "#core/model/model-client.js";
import { CONTEXT_WINDOW, Context, truncateToolResult } from "./context.js";

function summarizer() {
  const create = vi.fn(async (params: MessageCreateParams): Promise<KotaModelResponse> => ({
    id: "summary", role: "assistant", model: params.model, stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "Narrative" }],
  }));
  const client: ModelClient = { messages: { create, stream() { throw new Error("unexpected streaming request"); } } };
  return { create, client };
}
function conversation(turns: number): KotaMessage[] {
  return [{ role: "user", content: "Refactor login" }, ...Array.from({ length: turns }, (_, i): KotaMessage[] => [
    { role: "assistant", content: [{ type: "tool_use", id: `read-${i}`, name: "file_read", input: { path: `file-${i}.ts` } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: `read-${i}`, content: "x".repeat(2000) }] },
  ]).flat()];
}

describe("Context", () => {
  let ctx: Context;
  let dir: string;
  beforeEach(() => { ctx = new Context("Base instructions"); dir = mkdtempSync(join(tmpdir(), "kota-context-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.useRealTimers(); });

  it.each([0, 0.5, 0.75, 0.8])("propagates budget %s into tool bounds, warning and compaction admission", (fraction) => {
    ctx.setInputTokens(CONTEXT_WINDOW * fraction);
    expect(ctx.getBudgetPercent()).toBe(fraction);
    expect(ctx.getToolResultLimit()).toBe(fraction > 0.75 ? 5000 : fraction > 0.5 ? 15000 : 50000);
    expect(ctx.needsCompaction()).toBe(fraction > 0.75);
    const state = ctx.getDynamicState();
    if (fraction <= 0.5) expect(state).not.toContain("Context budget");
    else expect(state).toContain(`Context budget: ${fraction * 100}%`);
    expect(state.includes("CRITICAL")).toBe(fraction > 0.75);
  });

  it("admits compaction at the message safety boundary even with a low token estimate", () => {
    ctx.restoreFrom(conversation(49), 0, 0);
    ctx.addAssistantText("Done");
    expect(ctx.needsCompaction()).toBe(false);
    ctx.addUserMessage("Continue");
    expect(ctx.needsCompaction()).toBe(true);
  });

  it("keeps time and budget dynamic while preserving the appended static prompt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
    ctx.appendSystemPrompt("\nModule instructions");
    ctx.setInputTokens(160000);
    const first = ctx.getDynamicState();
    expect(first).toMatch(/^\[Current time: Thursday, September 10, 2026/);
    expect(first.indexOf("Context budget")).toBeGreaterThan(first.indexOf("Current time"));
    vi.setSystemTime(new Date("2026-09-11T12:00:00Z"));
    expect(ctx.getDynamicState()).not.toBe(first);
    expect(ctx.getStaticPrompt()).toBe("Base instructions\nModule instructions");
  });

  it("persists the transcript, rich tool results and counters for restore", async () => {
    ctx.addUserMessage("Request");
    const { client } = summarizer();
    const response = await client.messages.create({ model: "model", max_tokens: 1, messages: [] });
    ctx.addAssistantMessage(response);
    ctx.addAssistantText("Explanation");
    ctx.addToolResults([
      { tool_use_id: "plain", content: "plain result", is_error: true },
      { tool_use_id: "rich", content: "unused fallback", blocks: [
        { type: "text", text: "Rich result", _meta: { block: "b" } },
        { type: "mcp_content", content: { type: "audio", data: "audio", mimeType: "audio/wav" } },
      ], structuredContent: { rows: 2 }, _meta: { cache: "c" } },
    ]);
    const expected: KotaMessage[] = [
      { role: "user", content: "Request" }, { role: "assistant", content: [{ type: "text", text: "Narrative" }] },
      { role: "assistant", content: "Explanation" }, { role: "user", content: [
        { type: "tool_result", tool_use_id: "plain", content: "plain result", is_error: true },
        { type: "tool_result", tool_use_id: "rich", content: [
          { type: "text", text: "Rich result", _meta: { block: "b" } },
          { type: "mcp_content", content: { type: "audio", data: "audio", mimeType: "audio/wav" } },
        ], structuredContent: { rows: 2 }, _meta: { cache: "c" } },
      ] },
    ];
    ctx.restoreFrom(ctx.getMessages(), 2, 42000);
    const path = join(dir, "session.json");
    ctx.save(path);
    const saved = { messages: expected, compactionCount: 2, lastInputTokens: 42000 };
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(saved);
    const restored = Context.load(path, "New base instructions");
    expect(restored.snapshot()).toEqual(saved);
    expect(restored.getStats()).toEqual({ turns: 4, compactions: 2, inputTokens: 42000 });
    expect(restored.getStaticPrompt()).toBe("New base instructions");
  });

  it.each([
    ["missing", undefined, 0], ["broken JSON", "{broken", 0],
    ["missing messages", '{"compactionCount":2}', 2],
    ["wrong field types", '{"messages":"invalid","compactionCount":"bad","lastInputTokens":null}', 0],
  ] as const)("loads safe defaults for %s", (_, raw, compactionCount) => {
    const path = join(dir, "session.json");
    if (raw !== undefined) writeFileSync(path, raw);
    expect(Context.load(path, "Base").snapshot()).toEqual({ messages: [], compactionCount, lastInputTokens: 0 });
  });

  it("reports a failed save without corrupting the in-memory conversation", () => {
    ctx.addUserMessage("Unsaved request");
    expect(() => ctx.save(join(dir, "absent", "session.json"))).not.toThrow();
    expect(ctx.getMessages()).toEqual([{ role: "user", content: "Unsaved request" }]);
  });

  it.each([10, 11])("does not send a model request when %s messages leave nothing to summarize", async (count) => {
    const messages = conversation(5).slice(0, count);
    ctx.restoreFrom(messages, 0, 180000);
    const before = structuredClone(ctx.snapshot());
    const { client, create } = summarizer();
    await ctx.compact(client, "model");
    expect(create).not.toHaveBeenCalled();
    expect(ctx.snapshot()).toEqual(before);
  });

  it.each([20, 21])("preserves the entire recent suffix and tool pairing over repeated compaction of %s messages", async (count) => {
    ctx.restoreFrom(conversation(10).slice(0, count), 0, 160000);
    const { client } = summarizer();
    for (let pass = 1; pass <= 2; pass++) {
      const before = structuredClone(ctx.getMessages());
      const keep = before.slice(-10)[0].role === "user" ? 10 : 11;
      await ctx.compact(client, "model");
      const after = ctx.getMessages();
      expect(after.slice(2)).toEqual(before.slice(-keep));
      expect(after.length).toBeLessThan(before.length);
      expect(after[0].role).toBe("user");
      for (let i = 1; i < after.length; i++) expect(after[i].role).not.toBe(after[i - 1].role);
      expect(ctx.getStats().compactions).toBe(pass);
      if (pass === 1) {
        if (after.at(-1)?.role === "assistant") ctx.addUserMessage("Continue");
        ctx.getMessages().push(...conversation(10).slice(1));
      }
    }
  });

  it("prunes only above the budget threshold and persists the exact retained observation boundary", () => {
    ctx.restoreFrom(conversation(20), 0, 0);
    const before = structuredClone(ctx.getMessages());
    expect(ctx.maybePrune()).toEqual({ prunedCount: 0, charsSaved: 0 });
    expect(ctx.getMessages()).toEqual(before);
    ctx.setInputTokens(120000);
    expect(ctx.maybePrune().prunedCount).toBe(10);
    expect(ctx.getMessages().slice(-20)).toEqual(before.slice(-20));
    expect((ctx.getMessages()[2].content as KotaToolResultBlock[])[0].content).toContain("file-0.ts");
    const path = join(dir, "pruned.json");
    ctx.save(path);
    expect(Context.load(path, "Base").snapshot()).toEqual(ctx.snapshot());
  });

  it("masks the old observation through Context even at zero budget usage", () => {
    ctx.restoreFrom(conversation(6), 0, 0);
    const before = structuredClone(ctx.getMessages());
    expect(ctx.maskOldObservations().maskedCount).toBe(1);
    expect((ctx.getMessages()[2].content as KotaToolResultBlock[])[0].content).toBe("[Observed: read file-0.ts]");
    expect(ctx.getMessages().slice(-10)).toEqual(before.slice(-10));
  });

  it("truncates a new result using the current budget while preserving head, tail and omitted count", () => {
    for (const text of ["", "short", "x".repeat(500)]) expect(truncateToolResult(text, 500)).toBe(text);
    ctx.setInputTokens(160000);
    const text = `${"a".repeat(6000)}${"b".repeat(4000)}`;
    const truncated = truncateToolResult(text, ctx.getToolResultLimit());
    expect(truncated.startsWith("a".repeat(3000))).toBe(true);
    expect(truncated.endsWith("b".repeat(1500))).toBe(true);
    expect(truncated).toContain("5500 chars omitted");
    expect(truncated.length).toBeLessThan(text.length);
  });
});
