import type Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { CONTEXT_WINDOW, Context, truncateToolResult } from "./core/loop/context.js";
import type { ModelClient } from "./model/model-client.js";

// --- truncateToolResult ---

describe("truncateToolResult", () => {
  it("returns short content unchanged", () => {
    expect(truncateToolResult("short", 100)).toBe("short");
  });

  it("returns content at exact limit unchanged", () => {
    const content = "x".repeat(100);
    expect(truncateToolResult(content, 100)).toBe(content);
  });

  it("truncates long content with head + tail + notice", () => {
    const content = "A".repeat(300) + "B".repeat(700);
    const result = truncateToolResult(content, 500);
    // Head: 60% of 500 = 300 chars
    expect(result.startsWith("A".repeat(300))).toBe(true);
    // Tail: 30% of 500 = 150 chars → last 150 of "B"x700
    expect(result.endsWith("B".repeat(150))).toBe(true);
    // Notice in the middle
    expect(result).toContain("chars omitted");
  });

  it("preserves correct omitted count", () => {
    const content = "x".repeat(1000);
    const result = truncateToolResult(content, 500);
    const keepStart = Math.floor(500 * 0.6); // 300
    const keepEnd = Math.floor(500 * 0.3);   // 150
    const omitted = 1000 - keepStart - keepEnd; // 550
    expect(result).toContain(`${omitted} chars omitted`);
  });

  it("handles empty string", () => {
    expect(truncateToolResult("", 100)).toBe("");
  });
});

// --- Context class ---

describe("Context", () => {
  let ctx: Context;

  beforeEach(() => {
    ctx = new Context("You are a test assistant.");
  });

  describe("getBudgetPercent", () => {
    it("returns 0 when no tokens have been set", () => {
      expect(ctx.getBudgetPercent()).toBe(0);
    });

    it("returns correct percentage", () => {
      ctx.setInputTokens(100_000);
      expect(ctx.getBudgetPercent()).toBe(100_000 / CONTEXT_WINDOW);
    });

    it("returns 1.0 at full context window", () => {
      ctx.setInputTokens(CONTEXT_WINDOW);
      expect(ctx.getBudgetPercent()).toBe(1);
    });
  });

  describe("getToolResultLimit", () => {
    it("returns 50K when budget is low", () => {
      ctx.setInputTokens(0);
      expect(ctx.getToolResultLimit()).toBe(50_000);
    });

    it("returns 50K at 49% budget", () => {
      ctx.setInputTokens(Math.floor(CONTEXT_WINDOW * 0.49));
      expect(ctx.getToolResultLimit()).toBe(50_000);
    });

    it("returns 15K at 51% budget", () => {
      ctx.setInputTokens(Math.floor(CONTEXT_WINDOW * 0.51));
      expect(ctx.getToolResultLimit()).toBe(15_000);
    });

    it("returns 15K at 74% budget", () => {
      ctx.setInputTokens(Math.floor(CONTEXT_WINDOW * 0.74));
      expect(ctx.getToolResultLimit()).toBe(15_000);
    });

    it("returns 5K at 76% budget", () => {
      ctx.setInputTokens(Math.floor(CONTEXT_WINDOW * 0.76));
      expect(ctx.getToolResultLimit()).toBe(5_000);
    });
  });

  describe("needsCompaction", () => {
    it("returns false with fresh context", () => {
      expect(ctx.needsCompaction()).toBe(false);
    });

    it("returns true when tokens exceed 75% threshold", () => {
      ctx.setInputTokens(150_001);
      expect(ctx.needsCompaction()).toBe(true);
    });

    it("returns true when message count exceeds safety limit", () => {
      for (let i = 0; i < 101; i++) {
        ctx.addUserMessage(`msg ${i}`);
      }
      expect(ctx.needsCompaction()).toBe(true);
    });

    it("returns false just below token threshold", () => {
      ctx.setInputTokens(150_000);
      expect(ctx.needsCompaction()).toBe(false);
    });
  });

  describe("maybePrune", () => {
    it("skips pruning when budget is below 50%", () => {
      ctx.setInputTokens(50_000);
      const stats = ctx.maybePrune();
      expect(stats.prunedCount).toBe(0);
      expect(stats.charsSaved).toBe(0);
    });

    it("prunes when budget exceeds 50%", () => {
      // Build enough messages: assistant with tool_use, then user with tool_result
      for (let i = 0; i < 25; i++) {
        ctx.addAssistantText("thinking...");
        // Add assistant message with tool_use block
        const toolUseId = `tool_${i}`;
        const assistantContent: Anthropic.Messages.ContentBlockParam[] = [
          {
            type: "tool_use",
            id: toolUseId,
            name: "file_read",
            input: { path: `/tmp/file${i}.txt` },
          },
        ];
        ctx.getMessages().push({ role: "assistant", content: assistantContent });
        // Add corresponding tool result
        ctx.getMessages().push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUseId,
              content: "x".repeat(2000), // > minLength of 1500
            },
          ],
        });
      }

      ctx.setInputTokens(120_000); // 60% — above 50% threshold
      const stats = ctx.maybePrune();
      expect(stats.prunedCount).toBeGreaterThan(0);
      expect(stats.charsSaved).toBeGreaterThan(0);
    });
  });

  describe("getDynamicState", () => {
    it("includes current time context", () => {
      const state = ctx.getDynamicState();
      expect(state).toMatch(/\[Current time: \w+day, \w+ \d{1,2}, \d{4}/);
    });

    it("time context appears before todo and budget state", () => {
      ctx.setInputTokens(120_000);
      const state = ctx.getDynamicState();
      const timeIdx = state.indexOf("[Current time:");
      const budgetIdx = state.indexOf("[Context budget:");
      expect(timeIdx).toBe(0);
      expect(budgetIdx).toBeGreaterThan(timeIdx);
    });

    it("omits budget warning when below 50%", () => {
      ctx.setInputTokens(50_000);
      const state = ctx.getDynamicState();
      expect(state).not.toContain("Context budget");
    });

    it("includes budget warning between 50% and 75%", () => {
      ctx.setInputTokens(120_000);
      const state = ctx.getDynamicState();
      expect(state).toContain("Context budget: 60%");
      expect(state).toContain("be concise");
    });

    it("includes critical warning above 75%", () => {
      ctx.setInputTokens(160_000);
      const state = ctx.getDynamicState();
      expect(state).toContain("Context budget: 80%");
      expect(state).toContain("CRITICAL");
    });

    it("time includes weekday and timezone", () => {
      const state = ctx.getDynamicState();
      // Should contain a weekday name and timezone abbreviation
      expect(state).toMatch(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/);
      expect(state).toMatch(/\b([A-Z]{2,5}|GMT[+-]\d+)\]$/m);
    });
  });

  describe("message management", () => {
    it("adds user messages", () => {
      ctx.addUserMessage("hello");
      expect(ctx.getMessages()).toHaveLength(1);
      expect(ctx.getMessages()[0]).toEqual({ role: "user", content: "hello" });
    });

    it("adds assistant text", () => {
      ctx.addAssistantText("response");
      expect(ctx.getMessages()).toHaveLength(1);
      expect(ctx.getMessages()[0]).toEqual({ role: "assistant", content: "response" });
    });

    it("adds tool results with text content", () => {
      ctx.addToolResults([
        { tool_use_id: "id1", content: "result1" },
        { tool_use_id: "id2", content: "result2", is_error: true },
      ]);
      const msgs = ctx.getMessages();
      expect(msgs).toHaveLength(1);
      const content = msgs[0].content as Anthropic.Messages.ToolResultBlockParam[];
      expect(content).toHaveLength(2);
      expect(content[0].tool_use_id).toBe("id1");
      expect(content[1].is_error).toBe(true);
    });

    it("adds tool results with block content", () => {
      ctx.addToolResults([
        {
          tool_use_id: "id1",
          content: "fallback",
          blocks: [{ type: "text", text: "rich content" }],
        },
      ]);
      const content = ctx.getMessages()[0].content as Anthropic.Messages.ToolResultBlockParam[];
      // When blocks are provided, they should be used instead of string content
      expect(content[0].content).toEqual([{ type: "text", text: "rich content" }]);
    });
  });

  describe("save/load", () => {
    it("roundtrips messages and state", async () => {
      const { mkdtempSync, rmSync } = await import("node:fs");
      const { join } = await import("node:path");
      const tmpDir = mkdtempSync("/tmp/kota-ctx-test-");
      const filePath = join(tmpDir, "session.json");

      try {
        ctx.addUserMessage("hello");
        ctx.addAssistantText("hi there");
        ctx.setInputTokens(42_000);

        ctx.save(filePath);
        const loaded = Context.load(filePath, "You are a test assistant.");

        expect(loaded.getMessages()).toHaveLength(2);
        expect(loaded.getInputTokens()).toBe(42_000);
        expect(loaded.getStats().compactions).toBe(0);
        expect(loaded.getMessages()[0]).toEqual({ role: "user", content: "hello" });
      } finally {
        rmSync(tmpDir, { recursive: true });
      }
    });

    it("load returns fresh context for corrupted JSON", async () => {
      const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const tmpDir = mkdtempSync("/tmp/kota-ctx-test-");
      const filePath = join(tmpDir, "session.json");

      try {
        writeFileSync(filePath, "{broken json!!!", "utf-8");
        const loaded = Context.load(filePath, "system prompt");
        expect(loaded.getMessages()).toHaveLength(0);
        expect(loaded.getStats().compactions).toBe(0);
        expect(loaded.getInputTokens()).toBe(0);
      } finally {
        rmSync(tmpDir, { recursive: true });
      }
    });

    it("load returns fresh context for nonexistent file", () => {
      const loaded = Context.load("/tmp/kota-nonexistent-session-file.json", "prompt");
      expect(loaded.getMessages()).toHaveLength(0);
    });

    it("load handles missing messages field without crashing", async () => {
      const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const tmpDir = mkdtempSync("/tmp/kota-ctx-test-");
      const filePath = join(tmpDir, "session.json");

      try {
        writeFileSync(filePath, JSON.stringify({ compactionCount: 2 }), "utf-8");
        const loaded = Context.load(filePath, "prompt");
        // messages field missing → defaults to []
        expect(loaded.getMessages()).toHaveLength(0);
        expect(loaded.getStats().compactions).toBe(2);
        expect(loaded.getInputTokens()).toBe(0);
      } finally {
        rmSync(tmpDir, { recursive: true });
      }
    });

    it("load handles non-array messages field", async () => {
      const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const tmpDir = mkdtempSync("/tmp/kota-ctx-test-");
      const filePath = join(tmpDir, "session.json");

      try {
        writeFileSync(filePath, JSON.stringify({ messages: "not an array", compactionCount: "bad", lastInputTokens: null }), "utf-8");
        const loaded = Context.load(filePath, "prompt");
        expect(loaded.getMessages()).toHaveLength(0);
        expect(loaded.getStats().compactions).toBe(0);
        expect(loaded.getInputTokens()).toBe(0);
      } finally {
        rmSync(tmpDir, { recursive: true });
      }
    });

    it("save does not throw on permission error", async () => {
      // Saving to a nonexistent directory should not crash
      expect(() => {
        ctx.addUserMessage("test");
        ctx.save("/nonexistent-kota-dir/deep/nested/session.json");
      }).not.toThrow();
    });
  });

  describe("getStats", () => {
    it("returns correct stats", () => {
      ctx.addUserMessage("hello");
      ctx.addAssistantText("hi");
      ctx.setInputTokens(5000);

      const stats = ctx.getStats();
      expect(stats.turns).toBe(2);
      expect(stats.compactions).toBe(0);
      expect(stats.inputTokens).toBe(5000);
    });
  });

  describe("compact", () => {
    // Mock client that returns a canned summary
    function mockClient(): ModelClient {
      return {
        messages: {
          create: async () => ({
            content: [{ type: "text", text: "Summary of conversation so far." }],
          }),
        },
      } as unknown as ModelClient;
    }

    /** Build a realistic alternating conversation with tool_use/tool_result pairs. */
    function buildConversation(ctx: Context, turnCount: number): void {
      ctx.addUserMessage("initial prompt");
      for (let i = 0; i < turnCount; i++) {
        // assistant with tool_use
        ctx.getMessages().push({
          role: "assistant",
          content: [{
            type: "tool_use",
            id: `tool_${i}`,
            name: "file_read",
            input: { path: `file${i}.ts` },
          }],
        });
        // user with tool_result
        ctx.getMessages().push({
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: `tool_${i}`,
            content: `content of file${i}`,
          }],
        });
      }
    }

    /** Verify all messages alternate user/assistant roles (Anthropic API requirement). */
    function assertValidAlternation(messages: Anthropic.MessageParam[]): void {
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0].role).toBe("user"); // must start with user
      for (let i = 1; i < messages.length; i++) {
        expect(messages[i].role).not.toBe(messages[i - 1].role);
      }
    }

    it("skips compaction when message count is 10 or fewer", async () => {
      for (let i = 0; i < 10; i++) {
        ctx.addUserMessage(`msg ${i}`);
      }
      const mock = {} as ModelClient;
      await ctx.compact(mock, "test-model");
      expect(ctx.getMessages()).toHaveLength(10);
    });

    it("skips compaction when parity adjustment leaves nothing to summarize", async () => {
      // 11 messages where index 1 is assistant → keepRecent adjusts to 11 → toSummarize is empty
      // Before fix: this wasted an LLM call and GREW the message array (11 → 13)
      buildConversation(ctx, 5); // 1 initial user + 5*(assistant+user) = 11 messages
      expect(ctx.getMessages()).toHaveLength(11);

      // Verify the parity adjustment would trigger: messages[1] is assistant
      expect(ctx.getMessages()[1].role).toBe("assistant");

      const createSpy = { called: false };
      const spyClient = {
        messages: {
          create: async () => {
            createSpy.called = true;
            return { content: [{ type: "text", text: "Summary" }] };
          },
        },
      } as unknown as ModelClient;

      await ctx.compact(spyClient, "test-model");
      // Should not have called the LLM
      expect(createSpy.called).toBe(false);
      // Should not have grown the message array
      expect(ctx.getMessages()).toHaveLength(11);
      // Compaction count should not have incremented
      expect(ctx.getStats().compactions).toBe(0);
    });

    it("does not increment compactionCount if compactMessages throws", async () => {
      buildConversation(ctx, 15); // 31 messages — plenty to summarize
      expect(ctx.getStats().compactions).toBe(0);

      const throwClient = {
        messages: {
          create: async () => { throw new Error("API down"); },
        },
      } as unknown as ModelClient;

      // compactMessages catches the LLM error internally and falls back,
      // so this should still succeed. But let's verify count increments only once.
      await ctx.compact(throwClient, "test-model");
      expect(ctx.getStats().compactions).toBe(1);
      // Messages should still be reduced (fallback compaction)
      expect(ctx.getMessages().length).toBeLessThan(31);
    });

    it("maintains role alternation with even message count", async () => {
      // 20 messages (even): user, assistant, user, ..., user
      buildConversation(ctx, 9); // 1 initial + 9*2 = 19 messages
      ctx.getMessages().push({ role: "assistant", content: "done" }); // 20 total
      expect(ctx.getMessages()).toHaveLength(20);

      await ctx.compact(mockClient(), "test-model");
      assertValidAlternation(ctx.getMessages());
    });

    it("maintains role alternation with odd message count (bug regression)", async () => {
      // 21 messages (odd): user, assistant, user, ..., assistant, user, assistant
      // Without fix: keepRecent=10 starts at index 11 (assistant) → consecutive assistants
      buildConversation(ctx, 10); // 1 initial + 10*2 = 21 messages
      expect(ctx.getMessages()).toHaveLength(21);
      expect(ctx.getMessages()[11].role).toBe("assistant"); // the problematic index

      await ctx.compact(mockClient(), "test-model");
      assertValidAlternation(ctx.getMessages());
    });

    it("maintains alternation after multiple compactions", async () => {
      // First compaction shifts parity — ensure second compaction still works
      buildConversation(ctx, 10);
      await ctx.compact(mockClient(), "test-model");
      assertValidAlternation(ctx.getMessages());

      // Add more messages to trigger another compaction
      const postCompact = ctx.getMessages().length;
      for (let i = 0; i < 15; i++) {
        ctx.getMessages().push({
          role: "assistant",
          content: [{ type: "tool_use", id: `t2_${i}`, name: "shell", input: { command: `cmd${i}` } }],
        });
        ctx.getMessages().push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: `t2_${i}`, content: `result ${i}` }],
        });
      }
      expect(ctx.getMessages().length).toBeGreaterThan(postCompact + 10);

      await ctx.compact(mockClient(), "test-model");
      assertValidAlternation(ctx.getMessages());
      expect(ctx.getStats().compactions).toBe(2);
    });

    it("preserves recent messages through compaction", async () => {
      buildConversation(ctx, 10); // 21 messages
      const lastMsg = ctx.getMessages()[ctx.getMessages().length - 1];
      await ctx.compact(mockClient(), "test-model");

      // The last message should still be present
      const msgs = ctx.getMessages();
      expect(msgs[msgs.length - 1]).toEqual(lastMsg);
    });

    it("increments compaction count", async () => {
      buildConversation(ctx, 10);
      expect(ctx.getStats().compactions).toBe(0);
      await ctx.compact(mockClient(), "test-model");
      expect(ctx.getStats().compactions).toBe(1);
    });

    it("reduces message count", async () => {
      buildConversation(ctx, 10); // 21 messages
      const before = ctx.getMessages().length;
      await ctx.compact(mockClient(), "test-model");
      const after = ctx.getMessages().length;
      // Compaction replaces N-keepRecent messages with 2 (user summary + assistant ack)
      expect(after).toBeLessThan(before);
      // Should be: 2 (compacted) + keepRecent (10 or 11 depending on parity)
      expect(after).toBeLessThanOrEqual(13);
    });
  });

  describe("e2e: prune → compact → truncate pipeline", () => {
    function mockClient(): ModelClient {
      return {
        messages: {
          create: async () => ({
            content: [{ type: "text", text: "Compacted summary." }],
          }),
        },
      } as unknown as ModelClient;
    }

    it("prune reduces content, compact reduces messages, truncate limits new results", async () => {
      // Phase 1: Build a realistic long conversation
      ctx.addUserMessage("help me refactor this module");
      for (let i = 0; i < 20; i++) {
        ctx.getMessages().push({
          role: "assistant",
          content: [{ type: "tool_use", id: `t${i}`, name: "file_read", input: { path: `src/mod${i}.ts` } }],
        });
        ctx.getMessages().push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "x\n".repeat(1000) }],
        });
      }
      ctx.setInputTokens(120_000); // 60% budget → triggers pruning

      // Phase 2: Prune — should replace old file_read results with summaries
      const pruneStats = ctx.maybePrune();
      expect(pruneStats.prunedCount).toBeGreaterThan(0);
      expect(pruneStats.charsSaved).toBeGreaterThan(0);

      // Verify pruned messages still have valid structure
      for (const msg of ctx.getMessages()) {
        if (msg.role === "user" && Array.isArray(msg.content)) {
          for (const block of msg.content as Anthropic.Messages.ContentBlockParam[]) {
            if (block.type === "tool_result") {
              const tr = block as Anthropic.Messages.ToolResultBlockParam;
              // Content should be either original or a summary string
              expect(typeof tr.content === "string" || Array.isArray(tr.content)).toBe(true);
            }
          }
        }
      }

      // Phase 3: Simulate token growth → triggers compaction
      ctx.setInputTokens(155_000); // above 75% threshold
      expect(ctx.needsCompaction()).toBe(true);
      await ctx.compact(mockClient(), "test-model");

      // Verify compacted messages have valid alternation
      const msgs = ctx.getMessages();
      expect(msgs[0].role).toBe("user");
      for (let i = 1; i < msgs.length; i++) {
        expect(msgs[i].role).not.toBe(msgs[i - 1].role);
      }
      expect(msgs.length).toBeLessThan(41); // was 41 before compaction

      // Phase 4: Truncation — tool result limit adapts to budget
      expect(ctx.getToolResultLimit()).toBe(5_000); // at 77.5% budget

      // Verify truncateToolResult works with the limit
      const longResult = "z".repeat(10_000);
      const truncated = truncateToolResult(longResult, ctx.getToolResultLimit());
      expect(truncated.length).toBeLessThan(longResult.length);
      expect(truncated).toContain("chars omitted");
    });

    it("prune is no-op when budget is low, compact skips with few messages", async () => {
      ctx.addUserMessage("hello");
      ctx.addAssistantText("hi");
      ctx.setInputTokens(10_000); // 5% budget

      // Prune should be no-op
      const pruneStats = ctx.maybePrune();
      expect(pruneStats.prunedCount).toBe(0);

      // Compact should skip (only 2 messages)
      expect(ctx.needsCompaction()).toBe(false);
      await ctx.compact(mockClient(), "test-model");
      expect(ctx.getMessages()).toHaveLength(2);
    });

    it("snapshot captures post-prune state for history saving", () => {
      // Build messages with large tool results
      ctx.addUserMessage("start");
      for (let i = 0; i < 25; i++) {
        ctx.getMessages().push({
          role: "assistant",
          content: [{ type: "tool_use", id: `t${i}`, name: "file_read", input: { path: `f${i}.ts` } }],
        });
        ctx.getMessages().push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "data\n".repeat(500) }],
        });
      }
      ctx.setInputTokens(110_000); // > 50%

      // Prune
      ctx.maybePrune();

      // Snapshot should reflect pruned state (since pruning mutates in-place)
      const snap = ctx.snapshot();
      expect(snap.messages.length).toBe(ctx.getMessages().length);

      // Check that pruned results are summaries in the snapshot
      let hasSummary = false;
      for (const msg of snap.messages) {
        if (Array.isArray(msg.content)) {
          for (const block of msg.content as Anthropic.Messages.ContentBlockParam[]) {
            if (block.type === "tool_result") {
              const tr = block as Anthropic.Messages.ToolResultBlockParam;
              if (typeof tr.content === "string" && tr.content.includes("Previously read")) {
                hasSummary = true;
              }
            }
          }
        }
      }
      expect(hasSummary).toBe(true);
    });
  });
});
