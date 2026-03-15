import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { Context, truncateToolResult } from "./context.js";
import { extractWorkingState, compactMessages } from "./compaction.js";
import { pruneMessages, buildToolCallMap, generateSummary } from "./message-pruning.js";

type Message = Anthropic.MessageParam;

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

/**
 * Build a realistic multi-turn conversation: user asks to refactor a module,
 * agent reads files, edits them, runs tests. Produces ~30 messages.
 */
function buildRefactoringSession(): Message[] {
  const msgs: Message[] = [];

  // Turn 1: user request
  msgs.push({ role: "user", content: "Refactor the auth module — extract token validation into its own file" });

  // Turn 2: agent reads the auth module (large result)
  msgs.push(toolUse("r1", "file_read", { path: "src/auth.ts" }));
  msgs.push(toolResult("r1", "x".repeat(3000))); // large file content

  // Turn 3: agent reads another file
  msgs.push(toolUse("r2", "file_read", { path: "src/auth.test.ts" }));
  msgs.push(toolResult("r2", "y".repeat(2500)));

  // Turn 4: agent greps for imports
  msgs.push(toolUse("g1", "grep", { pattern: "import.*auth" }));
  msgs.push(toolResult("g1", "z".repeat(2000)));

  // Turn 5: agent writes new file
  msgs.push(toolUse("w1", "file_write", { file_path: "src/token-validation.ts" }));
  msgs.push(toolResult("w1", "File written: src/token-validation.ts (45 lines)"));

  // Turn 6: agent edits original file
  msgs.push(toolUse("e1", "file_edit", { file_path: "src/auth.ts" }));
  msgs.push(toolResult("e1", "Edit applied (removed 30 lines)"));

  // Turn 7: agent runs tests (shell)
  msgs.push(toolUse("s1", "shell", { command: "npm test" }));
  msgs.push(toolResult("s1", "FAIL: 2 tests failed\nExpected import from token-validation", true));

  // Turn 8: agent fixes import
  msgs.push(toolUse("e2", "file_edit", { file_path: "src/auth.test.ts" }));
  msgs.push(toolResult("e2", "Edit applied"));

  // Turn 9: agent re-runs tests
  msgs.push(toolUse("s2", "shell", { command: "npm test" }));
  msgs.push(toolResult("s2", "All 24 tests passed"));

  // Turn 10: agent does a glob to find related files
  msgs.push(toolUse("gl1", "glob", { pattern: "src/**/*.ts" }));
  msgs.push(toolResult("gl1", "q".repeat(1800)));

  // Turn 11: multi_edit on two files
  msgs.push(toolUse("me1", "multi_edit", {
    edits: [{ file_path: "src/routes.ts" }, { file_path: "src/middleware.ts" }],
  }));
  msgs.push(toolResult("me1", "2 edits applied"));

  // Turn 12: agent reads repo map
  msgs.push(toolUse("rm1", "repo_map", { path: "src" }));
  msgs.push(toolResult("rm1", "w".repeat(2200)));

  // Pad with a few more user/assistant exchanges so we have enough messages
  msgs.push({ role: "assistant", content: "Refactoring complete. All tests pass." });
  msgs.push({ role: "user", content: "Great, can you also update the README?" });
  msgs.push(toolUse("r3", "file_read", { path: "README.md" }));
  msgs.push(toolResult("r3", "m".repeat(1600)));
  msgs.push(toolUse("e3", "file_edit", { file_path: "README.md" }));
  msgs.push(toolResult("e3", "Edit applied"));
  msgs.push({ role: "assistant", content: "README updated." });

  return msgs;
}

describe("context-pipeline cross-module integration", () => {
  it("pruning preserves file modification tracking for subsequent compaction", () => {
    const msgs = buildRefactoringSession();
    const originalLength = msgs.length;

    // Prune with keepRecent=5 so most messages are eligible
    const stats = pruneMessages(msgs, { keepRecent: 5, minLength: 1500 });

    // Should have pruned the large read-only results (file_read, grep, glob, repo_map)
    expect(stats.prunedCount).toBeGreaterThan(0);
    expect(stats.charsSaved).toBeGreaterThan(3000);
    // Message count unchanged — pruning replaces content, doesn't remove messages
    expect(msgs.length).toBe(originalLength);

    // Now extract working state from the PRUNED messages
    const state = extractWorkingState(msgs);

    // File modifications must still be tracked despite pruning
    expect(state.filesModified).toContain("src/token-validation.ts");
    expect(state.filesModified).toContain("src/auth.ts");
    expect(state.filesModified).toContain("src/auth.test.ts");
    expect(state.filesModified).toContain("README.md");
    expect(state.filesModified).toContain("src/routes.ts");
    expect(state.filesModified).toContain("src/middleware.ts");
    expect(state.filesModified).toHaveLength(6);

    // Shell commands must still be tracked
    expect(state.commandsRun).toContain("npm test");

    // Errors must still be tracked
    expect(state.errors.length).toBeGreaterThan(0);
    expect(state.errors[0]).toContain("FAIL");
  });

  it("pruned read-only results are replaced with actionable summaries", () => {
    const msgs = buildRefactoringSession();
    pruneMessages(msgs, { keepRecent: 5, minLength: 1500 });

    // Find the pruned file_read result for src/auth.ts
    const toolMap = buildToolCallMap(msgs);
    for (const msg of msgs) {
      if (msg.role !== "user" || typeof msg.content === "string") continue;
      for (const block of msg.content as Anthropic.Messages.ContentBlockParam[]) {
        if (block.type !== "tool_result") continue;
        const tr = block as Anthropic.Messages.ToolResultBlockParam;
        const info = toolMap.get(tr.tool_use_id);
        if (info?.name === "file_read" && (info.input as { path?: string }).path === "src/auth.ts") {
          // Should be replaced with a summary, not the original 3000-char content
          expect(typeof tr.content).toBe("string");
          expect((tr.content as string).length).toBeLessThan(200);
          expect(tr.content).toContain("Previously read");
          expect(tr.content).toContain("src/auth.ts");
        }
      }
    }
  });

  it("write/edit tool results are never pruned", () => {
    const msgs = buildRefactoringSession();
    pruneMessages(msgs, { keepRecent: 2, minLength: 0 }); // aggressive pruning

    const toolMap = buildToolCallMap(msgs);
    for (const msg of msgs) {
      if (msg.role !== "user" || typeof msg.content === "string") continue;
      for (const block of msg.content as Anthropic.Messages.ContentBlockParam[]) {
        if (block.type !== "tool_result") continue;
        const tr = block as Anthropic.Messages.ToolResultBlockParam;
        const info = toolMap.get(tr.tool_use_id);
        if (info && (info.name === "file_edit" || info.name === "file_write" || info.name === "multi_edit")) {
          // Write results should NOT contain "Previously" summary markers
          expect(tr.content).not.toContain("Previously");
        }
      }
    }
  });

  it("error tool results are never pruned", () => {
    const msgs = buildRefactoringSession();
    pruneMessages(msgs, { keepRecent: 2, minLength: 0 });

    for (const msg of msgs) {
      if (msg.role !== "user" || typeof msg.content === "string") continue;
      for (const block of msg.content as Anthropic.Messages.ContentBlockParam[]) {
        if (block.type !== "tool_result") continue;
        const tr = block as Anthropic.Messages.ToolResultBlockParam;
        if (tr.is_error) {
          // Error content should be preserved, not replaced with summary
          expect(tr.content).toContain("FAIL");
        }
      }
    }
  });

  it("full pipeline: prune then compact preserves working state", async () => {
    const msgs = buildRefactoringSession();

    // Phase 1: prune (simulates 50% budget)
    pruneMessages(msgs, { keepRecent: 10, minLength: 1500 });

    // Phase 2: compact (simulates 75% budget) — mock LLM
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "User asked to refactor auth module. Token validation extracted to separate file. Tests fixed and passing." }],
        }),
      },
    } as unknown as Anthropic;

    const compacted = await compactMessages(mockClient, "claude-sonnet", msgs, 1);

    // Compacted result is exactly 2 messages: summary + ack
    expect(compacted).toHaveLength(2);
    expect(compacted[0].role).toBe("user");
    expect(compacted[1].role).toBe("assistant");

    // The summary must contain working state extracted from pruned messages
    const summaryContent = compacted[0].content as string;
    expect(summaryContent).toContain("Context compaction #1");
    expect(summaryContent).toContain("Working state");

    // File modifications must survive the prune → compact pipeline
    expect(summaryContent).toContain("src/token-validation.ts");
    expect(summaryContent).toContain("src/auth.ts");
    expect(summaryContent).toContain("src/auth.test.ts");
    expect(summaryContent).toContain("README.md");

    // Commands must survive
    expect(summaryContent).toContain("npm test");

    // Errors must survive
    expect(summaryContent).toContain("FAIL");

    // LLM narrative summary must be included
    expect(summaryContent).toContain("Token validation extracted");
  });

  it("compaction gracefully degrades when LLM call fails", async () => {
    const msgs = buildRefactoringSession();

    const failingClient = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error("API timeout")),
      },
    } as unknown as Anthropic;

    const compacted = await compactMessages(failingClient, "claude-sonnet", msgs, 2);

    // Should still produce valid output with fallback summary
    expect(compacted).toHaveLength(2);
    const summaryContent = compacted[0].content as string;
    expect(summaryContent).toContain("Context compaction #2");
    expect(summaryContent).toContain("Working state");
    // Deterministic state is preserved even when LLM fails
    expect(summaryContent).toContain("src/token-validation.ts");
    expect(summaryContent).toContain("npm test");
  });

  it("Context class orchestrates prune-then-compact lifecycle", async () => {
    const ctx = new Context("You are a helpful assistant.");

    // Simulate filling context with messages
    const session = buildRefactoringSession();
    for (const msg of session) {
      if (msg.role === "user") {
        if (typeof msg.content === "string") {
          ctx.addUserMessage(msg.content);
        } else {
          // Directly push tool_result messages
          (ctx as unknown as { messages: Message[] }).messages.push(msg);
        }
      } else {
        if (typeof msg.content === "string") {
          ctx.addAssistantText(msg.content);
        } else {
          (ctx as unknown as { messages: Message[] }).messages.push(msg);
        }
      }
    }

    const msgCountBefore = ctx.getTurnCount();

    // Simulate budget at 55% — should prune
    ctx.setInputTokens(110_000);
    expect(ctx.getBudgetPercent()).toBeCloseTo(0.55, 1);
    const pruneStats = ctx.maybePrune();
    expect(pruneStats.prunedCount).toBeGreaterThan(0);
    // Message count unchanged after pruning
    expect(ctx.getTurnCount()).toBe(msgCountBefore);

    // Simulate budget at 80% — should compact
    ctx.setInputTokens(160_000);
    expect(ctx.needsCompaction()).toBe(true);

    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "Auth module refactored." }],
        }),
      },
    } as unknown as Anthropic;

    await ctx.compact(mockClient, "claude-sonnet");

    // After compaction, message count should be reduced
    expect(ctx.getTurnCount()).toBeLessThan(msgCountBefore);
    // Stats should show 1 compaction
    expect(ctx.getStats().compactions).toBe(1);

    // The compacted messages should still contain working state
    const messages = ctx.getMessages();
    const firstMsg = messages[0];
    expect(typeof firstMsg.content).toBe("string");
    expect(firstMsg.content as string).toContain("src/token-validation.ts");
  });

  it("truncateToolResult interacts correctly with pruning thresholds", () => {
    // When context is tight, tool results get truncated before they even
    // reach the conversation history. This test verifies that truncated
    // results are still handled correctly by the pruning pipeline.
    const longContent = "a".repeat(60_000);
    const truncated = truncateToolResult(longContent, 15_000);

    // Truncated content should be ~15K chars
    expect(truncated.length).toBeLessThanOrEqual(15_100);
    expect(truncated).toContain("chars omitted");

    // If this truncated content is later in a tool_result, pruning should still work
    const msgs: Message[] = [
      toolUse("t1", "file_read", { path: "big-file.ts" }),
      toolResult("t1", truncated),
      // Add enough padding messages to have something to prune
      ...Array.from({ length: 22 }, (_, i) => [
        toolUse(`pad${i}`, "file_read", { path: `pad${i}.ts` }),
        toolResult(`pad${i}`, "short"),
      ]).flat(),
    ];

    const stats = pruneMessages(msgs, { keepRecent: 5, minLength: 1500 });
    // The truncated result (15K) should still be prunable
    expect(stats.prunedCount).toBeGreaterThanOrEqual(1);

    // Verify the pruned content is now a summary
    const firstResult = (msgs[1] as { role: string; content: Anthropic.Messages.ToolResultBlockParam[] })
      .content[0] as Anthropic.Messages.ToolResultBlockParam;
    expect(firstResult.content).toContain("Previously read");
    expect(firstResult.content).toContain("big-file.ts");
  });
});
