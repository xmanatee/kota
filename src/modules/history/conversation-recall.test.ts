import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HISTORY_PROVIDER_TOKEN, initProviderRegistry, resetProviderRegistry } from "#core/modules/provider-registry.js";
import { runConversationRecall } from "./conversation-recall.js";
import { ConversationHistory } from "./history.js";

let dir: string;
let history: ConversationHistory;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kota-recall-"));
  history = new ConversationHistory(dir);
  initProviderRegistry().register(HISTORY_PROVIDER_TOKEN, "test", history);
});
afterEach(() => {
  resetProviderRegistry();
  rmSync(dir, { recursive: true, force: true });
});

describe("conversation recall", () => {
  it.each([
    [{ action: "search" }, "query is required"],
    [{ action: "read" }, "id is required"],
    [{ action: "read", id: "missing" }, "not found"],
    [{ action: "bogus" }, "unknown action"],
  ])("reports invalid input %j", async (input, error) => {
    expect(await runConversationRecall(input)).toMatchObject({ is_error: true, content: expect.stringContaining(error) });
  });

  it("renders empty, filtered and limited results from the registered provider", async () => {
    expect(await runConversationRecall({ action: "list" })).toEqual({ content: "No conversations in history." });
    expect(await runConversationRecall({ action: "search", query: "absent" })).toEqual({ content: "No matching conversations found." });
    const first = history.create("model", "/scope");
    history.save(first, [{ role: "user", content: "Authentication fix" }], 0, 0);
    const last = history.create("model", "/scope", "action");
    history.save(last, [{ role: "user", content: "Other topic" }], 0, 0);
    const listed = await runConversationRecall({ action: "list", limit: 1 });
    expect(listed.content).toContain(`1 recent conversation(s):\n[${last}]`);
    expect(listed.content).toContain("1 msgs [auto]");
    expect(listed.content).not.toContain(first);
    const searched = await runConversationRecall({ action: "search", query: "authentication" });
    expect(searched.content).toContain(first);
    expect(searched.content).toContain("Authentication fix");
    expect(searched.content).not.toContain(last);
  });

  it("resolves a prefix and renders bounded recent messages with role and record metadata", async () => {
    const id = history.create("model", "/scope");
    history.save(id, [
      { role: "user", content: "Original topic" },
      ...Array.from({ length: 49 }, (_, i) => ({ role: "user" as const, content: `question-${i}` })),
      { role: "assistant", content: "A".repeat(1000) },
    ], 0, 0);
    const result = await runConversationRecall({ action: "read", id: id.slice(0, -1) });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain(`Conversation: Original topic\nID: ${id}`);
    expect(result.content).toContain("Messages: 51");
    expect(result.content).toContain("**User**: question-0");
    expect(result.content).toContain(`**Assistant**: ${"A".repeat(497)}...`);
    expect(result.content).not.toContain("A".repeat(500));
    expect(result.content).not.toContain("**User**: Original topic");
    expect(result.content).toContain("showing last 50 of 51 messages");
  });
});
