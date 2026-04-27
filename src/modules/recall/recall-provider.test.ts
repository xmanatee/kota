import { describe, expect, it } from "vitest";
import { RecallProviderImpl } from "./recall-provider.js";
import type {
  RawRecallEntry,
  RecallContributor,
  RecallSource,
} from "./recall-types.js";

function fixedContributor(
  source: RecallSource,
  hits: RawRecallEntry[],
): RecallContributor {
  return { source, async recall() { return hits; } };
}

function failingContributor(source: RecallSource, error: Error): RecallContributor {
  return {
    source,
    async recall() {
      throw error;
    },
  };
}

function knowledgeHit(id: string, nativeScore: number, title = id): RawRecallEntry {
  return {
    source: "knowledge",
    id,
    nativeScore,
    payload: { title, preview: `preview-${id}`, updated: "2026-04-01" },
  };
}

function memoryHit(id: string, nativeScore: number): RawRecallEntry {
  return {
    source: "memory",
    id,
    nativeScore,
    payload: { preview: `preview-${id}`, created: "2026-04-02" },
  };
}

function historyHit(id: string, nativeScore: number): RawRecallEntry {
  return {
    source: "history",
    id,
    nativeScore,
    payload: { title: `chat-${id}`, cwd: "/repo", updatedAt: "2026-04-03" },
  };
}

function tasksHit(id: string, nativeScore: number): RawRecallEntry {
  return {
    source: "tasks",
    id,
    nativeScore,
    payload: {
      title: `task-${id}`,
      state: "ready",
      priority: "p2",
      updatedAt: "2026-04-04",
    },
  };
}

describe("RecallProviderImpl", () => {
  it("merges hits from every contributor and tags each by source", async () => {
    const provider = new RecallProviderImpl({ onContributorError: () => {} });
    provider.register(fixedContributor("knowledge", [knowledgeHit("k1", 5), knowledgeHit("k2", 3)]));
    provider.register(fixedContributor("memory", [memoryHit("m1", 10)]));
    provider.register(fixedContributor("history", [historyHit("h1", 0.5)]));
    provider.register(fixedContributor("tasks", [tasksHit("t1", 0.9), tasksHit("t2", 0.4)]));

    const hits = await provider.recall("anything", { topK: 10 });
    const sources = new Set(hits.map((h) => h.source));
    expect(sources).toEqual(new Set(["knowledge", "memory", "history", "tasks"]));
    expect(hits.length).toBe(6);
  });

  it("normalizes scores per source via min-max into [0, 1]", async () => {
    const provider = new RecallProviderImpl({ onContributorError: () => {} });
    provider.register(fixedContributor("knowledge", [
      knowledgeHit("k1", 100),
      knowledgeHit("k2", 50),
      knowledgeHit("k3", 0),
    ]));

    const hits = await provider.recall("q", { topK: 10 });
    expect(hits).toHaveLength(3);
    const byId = Object.fromEntries(hits.map((h) => [h.id, h.score]));
    expect(byId.k1).toBeCloseTo(1, 5);
    expect(byId.k2).toBeCloseTo(0.5, 5);
    expect(byId.k3).toBeCloseTo(0, 5);
  });

  it("ranks merged hits by normalized score (desc) and clips to topK", async () => {
    const provider = new RecallProviderImpl({ onContributorError: () => {} });
    // Two-hit batches per source so each top hit normalizes to 1 and each
    // bottom hit to 0; the merged ranking groups all top hits before all
    // bottom hits regardless of cross-source absolute scale.
    provider.register(fixedContributor("tasks", [tasksHit("t1", 0.9), tasksHit("t2", 0.1)]));
    provider.register(fixedContributor("memory", [memoryHit("m1", 100), memoryHit("m2", 50)]));

    const hits = await provider.recall("q", { topK: 3 });
    // Top tier: m1 (memory before tasks by source order), then t1.
    // Bottom tier (normalized = 0): m2 first, then t2 — m2 fits the topK=3 cap.
    expect(hits.map((h) => h.id)).toEqual(["m1", "t1", "m2"]);
    expect(hits[0].score).toBeCloseTo(1, 5);
    expect(hits[1].score).toBeCloseTo(1, 5);
    expect(hits[2].score).toBeCloseTo(0, 5);
  });

  it("tie-breaks deterministically by source order then id", async () => {
    const provider = new RecallProviderImpl({ onContributorError: () => {} });
    // Each contributor has a single hit normalized to 1.
    provider.register(fixedContributor("history", [historyHit("z", 1)]));
    provider.register(fixedContributor("tasks", [tasksHit("a", 1)]));
    provider.register(fixedContributor("knowledge", [knowledgeHit("m", 1)]));
    provider.register(fixedContributor("memory", [memoryHit("b", 1)]));

    const hits = await provider.recall("q");
    // Source order: knowledge, memory, tasks, history
    expect(hits.map((h) => `${h.source}:${h.id}`)).toEqual([
      "knowledge:m",
      "memory:b",
      "tasks:a",
      "history:z",
    ]);
  });

  it("returns identical orderings on repeat calls (stable)", async () => {
    const provider = new RecallProviderImpl({ onContributorError: () => {} });
    provider.register(fixedContributor("knowledge", [knowledgeHit("k1", 0.6), knowledgeHit("k2", 0.4)]));
    provider.register(fixedContributor("tasks", [tasksHit("t1", 0.6), tasksHit("t2", 0.4)]));

    const a = await provider.recall("q");
    const b = await provider.recall("q");
    expect(a).toEqual(b);
  });

  it("degrades gracefully when a contributor returns zero hits", async () => {
    const provider = new RecallProviderImpl({ onContributorError: () => {} });
    provider.register(fixedContributor("knowledge", []));
    provider.register(fixedContributor("memory", [memoryHit("m1", 1)]));

    const hits = await provider.recall("q");
    expect(hits.map((h) => h.source)).toEqual(["memory"]);
  });

  it("degrades gracefully when a contributor throws (e.g. embedding failure)", async () => {
    const errors: Array<{ source: RecallSource; error: unknown }> = [];
    const provider = new RecallProviderImpl({
      onContributorError: (source, error) => errors.push({ source, error }),
    });
    provider.register(failingContributor("knowledge", new Error("embedding unreachable")));
    provider.register(fixedContributor("memory", [memoryHit("m1", 0.7)]));
    provider.register(fixedContributor("tasks", [tasksHit("t1", 0.5)]));

    const hits = await provider.recall("q");
    expect(hits.map((h) => h.source)).toEqual(["memory", "tasks"]);
    expect(errors).toHaveLength(1);
    expect(errors[0].source).toBe("knowledge");
  });

  it("filters by sources when set", async () => {
    const provider = new RecallProviderImpl({ onContributorError: () => {} });
    provider.register(fixedContributor("knowledge", [knowledgeHit("k1", 0.9)]));
    provider.register(fixedContributor("memory", [memoryHit("m1", 0.9)]));
    provider.register(fixedContributor("tasks", [tasksHit("t1", 0.9)]));

    const hits = await provider.recall("q", { sources: ["memory", "tasks"] });
    expect(hits.map((h) => h.source).sort()).toEqual(["memory", "tasks"]);
  });

  it("applies minScore floor", async () => {
    const provider = new RecallProviderImpl({ onContributorError: () => {} });
    provider.register(fixedContributor("knowledge", [
      knowledgeHit("k1", 100),
      knowledgeHit("k2", 50),
      knowledgeHit("k3", 0),
    ]));

    const hits = await provider.recall("q", { minScore: 0.5 });
    expect(hits.map((h) => h.id)).toEqual(["k1", "k2"]);
  });

  it("returns empty for blank query", async () => {
    const provider = new RecallProviderImpl({ onContributorError: () => {} });
    provider.register(fixedContributor("knowledge", [knowledgeHit("k1", 1)]));
    expect(await provider.recall("")).toEqual([]);
    expect(await provider.recall("   ")).toEqual([]);
  });

  it("returns empty when topK <= 0", async () => {
    const provider = new RecallProviderImpl({ onContributorError: () => {} });
    provider.register(fixedContributor("knowledge", [knowledgeHit("k1", 1)]));
    expect(await provider.recall("q", { topK: 0 })).toEqual([]);
  });

  it("re-registering the same source replaces the prior contributor", async () => {
    const provider = new RecallProviderImpl({ onContributorError: () => {} });
    provider.register(fixedContributor("knowledge", [knowledgeHit("k-old", 1)]));
    provider.register(fixedContributor("knowledge", [knowledgeHit("k-new", 1)]));
    const hits = await provider.recall("q");
    expect(hits.map((h) => h.id)).toEqual(["k-new"]);
    expect(provider.contributors()).toEqual(["knowledge"]);
  });

  it("payload fields propagate into the typed RecallHit", async () => {
    const provider = new RecallProviderImpl({ onContributorError: () => {} });
    provider.register(fixedContributor("tasks", [{
      source: "tasks",
      id: "t1",
      nativeScore: 0.8,
      payload: {
        title: "Add recall seam",
        state: "doing",
        priority: "p1",
        updatedAt: "2026-04-27",
      },
    }]));
    const [hit] = await provider.recall("q");
    expect(hit).toMatchObject({
      source: "tasks",
      id: "t1",
      title: "Add recall seam",
      state: "doing",
      priority: "p1",
      updatedAt: "2026-04-27",
    });
  });
});
