import { describe, it, expect, beforeEach } from "vitest";
import { Context, CONTEXT_WINDOW, truncateToolResult } from "./context.js";
import type Anthropic from "@anthropic-ai/sdk";

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
      expect(state).toMatch(/\b[A-Z]{2,5}\]$/m);
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
    it("skips compaction when message count is 10 or fewer", async () => {
      for (let i = 0; i < 10; i++) {
        ctx.addUserMessage(`msg ${i}`);
      }
      const mockClient = {} as Anthropic;
      await ctx.compact(mockClient, "test-model");
      // Messages unchanged
      expect(ctx.getMessages()).toHaveLength(10);
    });
  });
});
