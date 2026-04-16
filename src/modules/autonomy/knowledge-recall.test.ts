import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KnowledgeStore } from "#core/memory/knowledge-store.js";
import { recallForBuilder, recallForDecomposer, recallForExplorer, recallForImprover } from "./knowledge-recall.js";

describe("knowledge-recall", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-recall-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(projectDir, "data", "tasks", "doing"), { recursive: true });
    mkdirSync(join(projectDir, "data", "tasks", "ready"), { recursive: true });
    mkdirSync(join(projectDir, "data", "tasks", "backlog"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function seedTask(state: "doing" | "ready" | "backlog", id: string, attrs: Record<string, string>): void {
    const lines = ["---"];
    for (const [k, v] of Object.entries(attrs)) {
      lines.push(`${k}: ${v}`);
    }
    lines.push("---", "", "Task body.");
    writeFileSync(join(projectDir, "data", "tasks", state, `${id}.md`), lines.join("\n"));
  }

  function seedKnowledge(title: string, content: string, tags: string[] = []): string {
    const store = new KnowledgeStore(projectDir);
    return store.create({ title, content, type: "run-insight", tags, scope: "project" });
  }

  describe("recallForBuilder", () => {
    it("returns empty when no tasks exist", () => {
      const result = recallForBuilder(projectDir);
      expect(result.query).toBe("");
      expect(result.entries).toEqual([]);
    });

    it("returns matching entries for a doing task", () => {
      seedTask("doing", "task-fix-workflow", {
        title: "Fix workflow timeout handling",
        area: "autonomy",
      });
      const entryId = seedKnowledge(
        "Workflow timeout lesson",
        "Builder timed out because the repair loop was infinite. Fixed by adding max attempts.",
        ["workflow:builder", "area:autonomy"],
      );

      const result = recallForBuilder(projectDir);
      expect(result.query).toContain("Fix workflow timeout handling");
      expect(result.query).toContain("autonomy");
      expect(result.entries.length).toBeGreaterThanOrEqual(1);
      expect(result.entries.some((e) => e.id === entryId)).toBe(true);
    });

    it("returns matching entries from ready tasks when doing is empty", () => {
      seedTask("ready", "task-add-module", {
        title: "Add notification module",
        area: "modules",
        summary: "Wire up webhook notifications",
      });
      const entryId = seedKnowledge(
        "Notification wiring insight",
        "Webhook module needs explicit channel registration in daemon startup.",
        ["area:modules"],
      );

      const result = recallForBuilder(projectDir);
      expect(result.query).toContain("Add notification module");
      expect(result.query).toContain("webhook notifications");
      expect(result.entries.some((e) => e.id === entryId)).toBe(true);
    });

    it("falls back to backlog tasks when doing and ready are empty", () => {
      seedTask("backlog", "task-add-embeddings", {
        title: "Add semantic search with embeddings",
        area: "knowledge",
        summary: "Integrate vector embeddings into the knowledge store",
      });
      const entryId = seedKnowledge(
        "Knowledge store architecture",
        "Knowledge store uses flat files with frontmatter. Search is keyword-based.",
        ["area:knowledge"],
      );

      const result = recallForBuilder(projectDir);
      expect(result.query).toContain("Add semantic search with embeddings");
      expect(result.query).toContain("knowledge");
      expect(result.entries.some((e) => e.id === entryId)).toBe(true);
    });

    it("ignores backlog when doing tasks exist", () => {
      seedTask("doing", "task-current", {
        title: "Current work item",
        area: "core",
      });
      seedTask("backlog", "task-future", {
        title: "Future backlog item",
        area: "modules",
      });

      const result = recallForBuilder(projectDir);
      expect(result.query).toContain("Current work item");
      expect(result.query).not.toContain("Future backlog item");
    });

    it("returns empty entries when store has no matches", () => {
      seedTask("doing", "task-unrelated", {
        title: "Refactor database layer",
        area: "storage",
      });
      seedKnowledge("Totally unrelated topic", "About cooking recipes.", ["food"]);

      const result = recallForBuilder(projectDir);
      expect(result.query).toContain("Refactor database layer");
      expect(result.entries).toEqual([]);
    });

    it("limits entries to MAX_ENTRIES (5)", () => {
      seedTask("doing", "task-broad", { title: "workflow improvement", area: "core" });
      for (let i = 0; i < 8; i++) {
        seedKnowledge(`Workflow insight ${i}`, `Workflow lesson number ${i}`, ["area:core"]);
      }

      const result = recallForBuilder(projectDir);
      expect(result.entries.length).toBeLessThanOrEqual(5);
    });

    it("truncates long content in summaries", () => {
      seedTask("doing", "task-long", { title: "long content test", area: "test" });
      const longContent = "A".repeat(500);
      seedKnowledge("Long entry", longContent, ["area:test"]);

      const result = recallForBuilder(projectDir);
      const match = result.entries.find((e) => e.title === "Long entry");
      expect(match).toBeDefined();
      expect(match!.summary.length).toBeLessThanOrEqual(301); // 300 + ellipsis
    });
  });

  describe("recallForImprover", () => {
    it("returns entries matching improver-relevant terms", () => {
      const entryId = seedKnowledge(
        "Builder cost analysis",
        "Autonomous builder runs averaged $2.50. Quality dropped on repair loops.",
        ["workflow:builder"],
      );

      const result = recallForImprover(projectDir);
      expect(result.query).toContain("workflow");
      expect(result.query).toContain("autonomous");
      expect(result.entries.some((e) => e.id === entryId)).toBe(true);
    });

    it("returns empty when store has no relevant entries", () => {
      seedKnowledge("Cooking recipes", "How to bake bread.", ["food"]);

      const result = recallForImprover(projectDir);
      expect(result.entries).toEqual([]);
    });

    it("uses a fixed query independent of task state", () => {
      const result1 = recallForImprover(projectDir);
      seedTask("doing", "task-something", { title: "Something" });
      const result2 = recallForImprover(projectDir);
      expect(result1.query).toBe(result2.query);
    });
  });

  describe("recallForExplorer", () => {
    it("returns entries matching exploration-relevant terms", () => {
      const entryId = seedKnowledge(
        "Architecture gap analysis",
        "Module discovery revealed a capability gap in the notification architecture.",
        ["area:architecture"],
      );

      const result = recallForExplorer(projectDir);
      expect(result.query).toContain("architecture");
      expect(result.query).toContain("module");
      expect(result.entries.some((e) => e.id === entryId)).toBe(true);
    });

    it("returns empty when no relevant entries exist", () => {
      seedKnowledge("Cooking recipes", "How to bake bread.", ["food"]);
      const result = recallForExplorer(projectDir);
      expect(result.entries).toEqual([]);
    });
  });

  describe("recallForDecomposer", () => {
    it("returns entries matching decomposition-relevant terms", () => {
      const entryId = seedKnowledge(
        "Builder timeout on large task",
        "Builder failure due to timeout on a task with too broad scope. Split into three subtasks.",
        ["workflow:builder"],
      );

      const result = recallForDecomposer(projectDir);
      expect(result.query).toContain("timeout");
      expect(result.query).toContain("builder");
      expect(result.entries.some((e) => e.id === entryId)).toBe(true);
    });

    it("returns empty when no relevant entries exist", () => {
      seedKnowledge("Cooking recipes", "How to bake bread.", ["food"]);
      const result = recallForDecomposer(projectDir);
      expect(result.entries).toEqual([]);
    });
  });
});
