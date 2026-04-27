import { describe, expect, it } from "vitest";
import type {
  ConversationRecord,
  HistoryProvider,
  KnowledgeEntry,
  KnowledgeProvider,
  Memory,
  MemoryProvider,
  RepoTaskSearchHit,
  RepoTasksProvider,
} from "#core/modules/provider-types.js";
import {
  createHistoryContributor,
  createKnowledgeContributor,
  createMemoryContributor,
  createTasksContributor,
} from "./contributors.js";

function knowledgeEntry(id: string): KnowledgeEntry {
  return {
    id,
    title: `Knowledge ${id}`,
    type: "doc",
    tags: [],
    status: "active",
    created: "2026-04-01",
    updated: "2026-04-02",
    content: `Long-form content for ${id} that is more than a sentence`,
    meta: {},
  };
}

function memoryEntry(id: string): Memory {
  return {
    id,
    content: `Note ${id}`,
    tags: [],
    created: "2026-04-03",
  };
}

function conversationRecord(id: string): ConversationRecord {
  return {
    id,
    title: `Chat ${id}`,
    createdAt: "2026-04-04",
    updatedAt: "2026-04-05",
    model: "claude",
    messageCount: 1,
    cwd: "/repo",
    source: "user",
  };
}

function repoTaskHit(id: string, score: number): RepoTaskSearchHit {
  return {
    id,
    title: `Task ${id}`,
    state: "ready",
    priority: "p2",
    area: "core",
    summary: `summary for ${id}`,
    updatedAt: "2026-04-06",
    score,
  };
}

describe("createKnowledgeContributor", () => {
  it("uses semanticSearch when supported", async () => {
    const provider: KnowledgeProvider = {
      create: () => "",
      read: () => null,
      update: () => false,
      delete: () => false,
      search: () => {
        throw new Error("should not call keyword path");
      },
      list: () => [],
      count: () => 0,
      supportsSemanticSearch: () => true,
      semanticSearch: async () => [knowledgeEntry("k1"), knowledgeEntry("k2")],
      reindex: async () => ({ indexed: 0, failed: 0 }),
    };
    const contributor = createKnowledgeContributor(provider);
    const hits = await contributor.recall("q", { topK: 5 });
    expect(hits.map((h) => h.id)).toEqual(["k1", "k2"]);
    expect(hits[0].source).toBe("knowledge");
    expect(hits[0].nativeScore).toBeGreaterThan(hits[1].nativeScore);
  });

  it("falls back to keyword search when semantic is unsupported", async () => {
    const provider: KnowledgeProvider = {
      create: () => "",
      read: () => null,
      update: () => false,
      delete: () => false,
      search: () => [knowledgeEntry("k-keyword")],
      list: () => [],
      count: () => 0,
      supportsSemanticSearch: () => false,
      semanticSearch: async () => {
        throw new Error("should not call semantic path");
      },
      reindex: async () => ({ indexed: 0, failed: 0, skipped: true }),
    };
    const contributor = createKnowledgeContributor(provider);
    const hits = await contributor.recall("q", { topK: 5 });
    expect(hits.map((h) => h.id)).toEqual(["k-keyword"]);
  });
});

describe("createMemoryContributor", () => {
  it("returns ranked entries via semantic when supported", async () => {
    const provider: MemoryProvider = {
      save: () => "",
      search: () => {
        throw new Error("should not call keyword path");
      },
      list: () => [],
      update: () => false,
      delete: () => false,
      supportsSemanticSearch: () => true,
      semanticSearch: async () => [memoryEntry("m1"), memoryEntry("m2"), memoryEntry("m3")],
      reindex: async () => ({ indexed: 0, failed: 0 }),
    };
    const hits = await createMemoryContributor(provider).recall("q", { topK: 3 });
    expect(hits.map((h) => h.id)).toEqual(["m1", "m2", "m3"]);
    expect(hits[0].source).toBe("memory");
  });

  it("falls back to keyword search and respects topK", async () => {
    const provider: MemoryProvider = {
      save: () => "",
      search: () => [memoryEntry("a"), memoryEntry("b"), memoryEntry("c")],
      list: () => [],
      update: () => false,
      delete: () => false,
      supportsSemanticSearch: () => false,
      semanticSearch: async () => {
        throw new Error("nope");
      },
      reindex: async () => ({ indexed: 0, failed: 0, skipped: true }),
    };
    const hits = await createMemoryContributor(provider).recall("q", { topK: 2 });
    expect(hits.map((h) => h.id)).toEqual(["a", "b"]);
  });
});

describe("createHistoryContributor", () => {
  it("uses semanticSearch when supported", async () => {
    const provider: HistoryProvider = {
      create: () => "",
      save: () => {},
      load: () => null,
      list: () => [],
      getMostRecent: () => null,
      findByPrefix: () => null,
      remove: () => false,
      cleanup: () => 0,
      supportsSemanticSearch: () => true,
      semanticSearch: async () => [conversationRecord("h1"), conversationRecord("h2")],
      reindex: async () => ({ indexed: 0, failed: 0 }),
    };
    const hits = await createHistoryContributor(provider).recall("q", { topK: 5 });
    expect(hits.map((h) => h.id)).toEqual(["h1", "h2"]);
    expect(hits[0].source).toBe("history");
  });

  it("falls back to list-with-search when semantic unsupported", async () => {
    let listCalled: { search?: string; limit?: number } = {};
    const provider: HistoryProvider = {
      create: () => "",
      save: () => {},
      load: () => null,
      list: (opts) => {
        listCalled = opts ?? {};
        return [conversationRecord("h-keyword")];
      },
      getMostRecent: () => null,
      findByPrefix: () => null,
      remove: () => false,
      cleanup: () => 0,
      supportsSemanticSearch: () => false,
      semanticSearch: async () => {
        throw new Error("nope");
      },
      reindex: async () => ({ indexed: 0, failed: 0, skipped: true }),
    };
    const hits = await createHistoryContributor(provider).recall("q", { topK: 7 });
    expect(hits.map((h) => h.id)).toEqual(["h-keyword"]);
    expect(listCalled).toMatchObject({ search: "q", limit: 7 });
  });
});

describe("createTasksContributor", () => {
  it("preserves repo-task hit metadata and surface scores", async () => {
    const provider: RepoTasksProvider = {
      supportsSemanticSearch: () => true,
      async searchTasks() {
        return [repoTaskHit("t1", 0.92), repoTaskHit("t2", 0.41)];
      },
      reindex: async () => ({ indexed: 0, failed: 0 }),
    };
    const hits = await createTasksContributor(provider).recall("q", { topK: 5 });
    expect(hits).toHaveLength(2);
    const first = hits[0];
    expect(first.source).toBe("tasks");
    if (first.source !== "tasks") throw new Error("type narrowing");
    expect(first.id).toBe("t1");
    expect(first.nativeScore).toBe(0.92);
    expect(first.payload.title).toBe("Task t1");
    expect(first.payload.state).toBe("ready");
    expect(first.payload.priority).toBe("p2");
  });
});
