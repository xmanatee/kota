import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationMessage } from "#core/modules/provider-types.js";
import { ConversationHistory } from "./history.js";
import { MAX_ACTION_CONVERSATIONS, MAX_USER_CONVERSATIONS } from "./history-utils.js";

let dir: string;
let history: ConversationHistory;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kota-history-"));
  history = new ConversationHistory(dir);
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

describe("ConversationHistory", () => {
  it.each([42, "", null])("rejects malformed persisted conversation ownership (%s)", (continuityKey) => {
    const id = history.create("model", "/scope");
    const data = history.load(id);
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ ...data, continuityKey }));
    expect(() => history.load(id)).toThrow("invalid conversation owner");
    expect(() => history.save(id, [], 0, 0)).toThrow("invalid conversation owner");
  });

  it("persists resume state and preserves its original title across compaction", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01"));
    const id = history.create("model", "/scope");
    expect(history.load(id)).toMatchObject({
      record: { id, model: "model", cwd: "/scope", source: "user", messageCount: 0 },
      messages: [], compactionCount: 0, lastInputTokens: 0,
    });
    history.save(id, [{ role: "user", content: "Original\n  title" }], 0, 10);
    vi.setSystemTime(new Date("2026-01-02"));
    const messages: ConversationMessage[] = [
      { role: "user", content: "Compacted context" },
      { role: "assistant", content: "Reply" },
    ];
    history.save(id, messages, 2, 1234);
    const reopened = new ConversationHistory(dir);
    expect(reopened.load(id)).toEqual({
      record: {
        id, model: "model", cwd: "/scope", source: "user", title: "Original title",
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", messageCount: 2,
      },
      messages, compactionCount: 2, lastInputTokens: 1234,
    });
    expect(reopened.list()).toEqual([reopened.load(id)?.record]);
  });

  it.each<{ content: ConversationMessage["content"]; title: string; count: number }>([
    { content: "Hello", title: "Hello", count: 1 },
    { content: "x".repeat(100), title: `${"x".repeat(77)}...`, count: 1 },
    { content: [
      { type: "tool_result", tool_use_id: "t", content: "not a title" },
      { type: "text", text: "First text" }, { type: "text", text: "Second text" },
    ], title: "First text", count: 1 },
    { content: [{ type: "tool_result", tool_use_id: "t", content: "tool output" }], title: "(new conversation)", count: 0 },
    { content: [], title: "(new conversation)", count: 0 },
  ])("projects user text into title and count: $title / $count", ({ content, title, count }) => {
    const id = history.create("model", "/scope");
    history.save(id, [{ role: "user", content }, { role: "assistant", content: "reply" }], 0, 0);
    expect(history.load(id)?.record).toMatchObject({ title, messageCount: count + 1 });
  });

  it("combines filters before limiting and returns the newest matching record", () => {
    const first = history.create("model", "/Alpha");
    const action = history.create("model", "/Alpha", "action");
    const last = history.create("model", "/Beta");
    history.save(first, [{ role: "user", content: "Needle" }], 0, 0);
    expect(history.list().map((r) => r.id)).toEqual([last, action, first]);
    expect(history.list({ cwd: "/Alpha", source: "user", limit: 1 }).map((r) => r.id)).toEqual([first]);
    expect(history.list({ search: "NEEDLE" }).map((r) => r.id)).toEqual([first]);
    expect(history.list({ search: "alpha" }).map((r) => r.id)).toEqual([action, first]);
    expect(history.list({ limit: 0 })).toEqual([]);
    expect(history.getMostRecent("/Alpha")?.id).toBe(action);
    expect(history.getMostRecent("/absent")).toBeNull();
  });

  it("prunes oldest files independently for user and action retention", () => {
    const users = Array.from({ length: MAX_USER_CONVERSATIONS + 1 }, () => history.create("model", "/scope"));
    const actions = Array.from({ length: MAX_ACTION_CONVERSATIONS + 1 }, () => history.create("model", "/scope", "action"));
    for (const [source, ids] of [["user", users], ["action", actions]] as const) {
      expect(history.list({ source, limit: ids.length }).map((r) => r.id)).toEqual(ids.slice(1).reverse());
      expect(history.load(ids[0])).toBeNull();
      expect(existsSync(join(dir, `${ids[0]}.json`))).toBe(false);
      for (const id of ids.slice(1)) expect(history.load(id)?.record.id).toBe(id);
    }
  });

  it("removes indexed data and cleans actual orphans without deleting other files", () => {
    const removed = history.create("model", "/scope");
    const kept = history.create("model", "/scope");
    expect(history.remove(removed)).toBe(true);
    expect(history.remove(removed)).toBe(false);
    expect(history.load(removed)).toBeNull();
    writeFileSync(join(dir, "orphan.json"), "{}");
    writeFileSync(join(dir, "notes.txt"), "retain");
    expect(history.cleanup()).toBe(1);
    expect(history.cleanup()).toBe(0);
    expect(readdirSync(dir).sort()).toEqual([`${kept}.json`, "index.json", "notes.txt"].sort());
    expect(new ConversationHistory(dir).list().map((r) => r.id)).toEqual([kept]);
  });

  it("rejects ambiguous prefixes while preferring exact identity and tolerating empty lookup", () => {
    // Author a persisted boundary example: generated IDs cannot deliberately have this relationship.
    const id = history.create("model", "/scope");
    const record = history.load(id)!.record;
    writeFileSync(join(dir, "index.json"), JSON.stringify({
      conversations: ["chat-a", "chat-abc"].map((id) => ({ ...record, id })),
    }));
    expect(history.findByPrefix(" chat-a ")?.id).toBe("chat-a");
    expect(history.findByPrefix("chat-ab")?.id).toBe("chat-abc");
    expect(() => history.findByPrefix("chat-")).toThrow("Ambiguous");
    for (const query of ["", "  ", "missing"]) expect(history.findByPrefix(query)).toBeNull();
  });
});
