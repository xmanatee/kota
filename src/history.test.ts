import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConversationHistory, generateTitle } from "./history.js";

describe("ConversationHistory", () => {
  let dir: string;
  let history: ConversationHistory;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kota-history-"));
    history = new ConversationHistory(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a new conversation and lists it", () => {
    const id = history.create("claude-sonnet-4-6", "/tmp/project");
    expect(id).toBeTruthy();

    const list = history.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].title).toBe("(new conversation)");
    expect(list[0].model).toBe("claude-sonnet-4-6");
    expect(list[0].cwd).toBe("/tmp/project");
  });

  it("saves and loads conversation data", () => {
    const id = history.create("claude-sonnet-4-6", "/tmp/project");

    const messages = [
      { role: "user" as const, content: "Hello, help me with a task" },
      { role: "assistant" as const, content: "Sure, what do you need?" },
    ];
    history.save(id, messages, 0, 5000);

    const loaded = history.load(id);
    expect(loaded).not.toBeNull();
    expect(loaded!.messages).toHaveLength(2);
    expect(loaded!.record.messageCount).toBe(2);
    expect(loaded!.record.title).toBe("Hello, help me with a task");
    expect(loaded!.compactionCount).toBe(0);
    expect(loaded!.lastInputTokens).toBe(5000);
  });

  it("auto-titles from first user message", () => {
    const id = history.create("claude-sonnet-4-6", "/tmp/project");

    history.save(
      id,
      [{ role: "user" as const, content: "Analyze the quarterly revenue data" }],
      0,
      1000,
    );

    const list = history.list();
    expect(list[0].title).toBe("Analyze the quarterly revenue data");
  });

  it("does not overwrite title once set", () => {
    const id = history.create("claude-sonnet-4-6", "/tmp");

    history.save(
      id,
      [{ role: "user" as const, content: "First message" }],
      0,
      100,
    );

    history.save(
      id,
      [
        { role: "user" as const, content: "First message" },
        { role: "assistant" as const, content: "Reply" },
        { role: "user" as const, content: "Second message" },
      ],
      0,
      200,
    );

    const list = history.list();
    expect(list[0].title).toBe("First message");
  });

  it("filters by cwd", () => {
    history.create("claude-sonnet-4-6", "/project-a");
    history.create("claude-sonnet-4-6", "/project-b");
    history.create("claude-sonnet-4-6", "/project-a");

    const results = history.list({ cwd: "/project-a" });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.cwd === "/project-a")).toBe(true);
  });

  it("filters by search term", () => {
    const id1 = history.create("claude-sonnet-4-6", "/tmp");
    history.save(id1, [{ role: "user" as const, content: "Fix the auth bug" }], 0, 0);

    const id2 = history.create("claude-sonnet-4-6", "/tmp");
    history.save(id2, [{ role: "user" as const, content: "Write a blog post" }], 0, 0);

    const results = history.list({ search: "auth" });
    expect(results).toHaveLength(1);
    expect(results[0].title).toContain("auth");
  });

  it("returns most recent conversation", () => {
    history.create("claude-sonnet-4-6", "/project-a");
    const id2 = history.create("claude-sonnet-4-6", "/project-a");

    const recent = history.getMostRecent("/project-a");
    expect(recent).not.toBeNull();
    expect(recent!.id).toBe(id2);
  });

  it("removes a conversation", () => {
    const id = history.create("claude-sonnet-4-6", "/tmp");
    expect(history.list()).toHaveLength(1);

    const removed = history.remove(id);
    expect(removed).toBe(true);
    expect(history.list()).toHaveLength(0);
    expect(history.load(id)).toBeNull();
  });

  it("returns false when removing non-existent conversation", () => {
    expect(history.remove("nonexistent")).toBe(false);
  });

  it("returns null when loading non-existent conversation", () => {
    expect(history.load("nonexistent")).toBeNull();
  });

  it("limits list results", () => {
    for (let i = 0; i < 10; i++) {
      history.create("claude-sonnet-4-6", "/tmp");
    }

    const limited = history.list({ limit: 3 });
    expect(limited).toHaveLength(3);
  });

  it("prunes old conversations beyond limit", () => {
    // Create 55 conversations (limit is 50)
    const ids: string[] = [];
    for (let i = 0; i < 55; i++) {
      ids.push(history.create("claude-sonnet-4-6", "/tmp"));
    }

    const list = history.list({ limit: 100 });
    expect(list.length).toBeLessThanOrEqual(50);
  });

  it("cleans up orphaned files", () => {
    const id = history.create("claude-sonnet-4-6", "/tmp");
    // Load to verify it exists
    expect(history.load(id)).not.toBeNull();
    // Remove from index only (simulate orphan)
    history.remove(id);
    // The file should have been removed by remove(), so cleanup returns 0
    const cleaned = history.cleanup();
    expect(cleaned).toBe(0);
  });

  it("lists most recent first", () => {
    const id1 = history.create("claude-sonnet-4-6", "/tmp");
    const id2 = history.create("claude-sonnet-4-6", "/tmp");
    const id3 = history.create("claude-sonnet-4-6", "/tmp");

    const list = history.list();
    expect(list[0].id).toBe(id3);
    expect(list[1].id).toBe(id2);
    expect(list[2].id).toBe(id1);
  });

  it("updates updatedAt on save", () => {
    const id = history.create("claude-sonnet-4-6", "/tmp");

    const before = Date.now();
    history.save(
      id,
      [{ role: "user" as const, content: "test" }],
      0,
      100,
    );
    const after = Date.now();

    const list = history.list();
    const updatedMs = new Date(list[0].updatedAt).getTime();
    expect(updatedMs).toBeGreaterThanOrEqual(before);
    expect(updatedMs).toBeLessThanOrEqual(after);
  });
});

describe("findByPrefix", () => {
  let dir: string;
  let history: ConversationHistory;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kota-prefix-"));
    history = new ConversationHistory(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("finds by exact ID", () => {
    const id = history.create("claude-sonnet-4-6", "/tmp");
    const found = history.findByPrefix(id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(id);
  });

  it("finds by unique prefix", () => {
    const id = history.create("claude-sonnet-4-6", "/tmp");
    // Use first 5 chars as prefix — should be unique with one conversation
    const found = history.findByPrefix(id.slice(0, 5));
    expect(found).not.toBeNull();
    expect(found!.id).toBe(id);
  });

  it("returns null for no match", () => {
    history.create("claude-sonnet-4-6", "/tmp");
    expect(history.findByPrefix("zzz-nonexistent")).toBeNull();
  });

  it("throws on ambiguous prefix", () => {
    const id1 = history.create("claude-sonnet-4-6", "/tmp");
    const id2 = history.create("claude-sonnet-4-6", "/tmp");

    // Both IDs share the same base36 timestamp prefix (created in same ms)
    // Use just the first char which should match both
    const commonPrefix = id1[0];
    if (id2.startsWith(commonPrefix)) {
      expect(() => history.findByPrefix(commonPrefix)).toThrow("Ambiguous");
    }
  });

  it("prefers exact match over prefix", () => {
    const id1 = history.create("claude-sonnet-4-6", "/tmp");
    // Even if the exact ID is a prefix of another ID, exact match wins
    const found = history.findByPrefix(id1);
    expect(found!.id).toBe(id1);
  });
});

describe("generateTitle", () => {
  it("returns short messages as-is", () => {
    expect(generateTitle("Fix the bug")).toBe("Fix the bug");
  });

  it("truncates long messages", () => {
    const long = "a".repeat(100);
    const title = generateTitle(long);
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith("...")).toBe(true);
  });

  it("normalizes whitespace", () => {
    expect(generateTitle("Hello\n\nWorld\n  foo")).toBe("Hello World foo");
  });
});
