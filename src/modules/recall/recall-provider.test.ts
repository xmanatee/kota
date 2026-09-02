import { describe, expect, it } from "vitest";
import type { RecallHit, RecallResult } from "./client.js";
import { RecallProviderImpl } from "./recall-provider.js";
import type {
  RawRecallEntry,
  RecallContributor,
  RecallSource,
} from "./recall-types.js";

function fixedContributor(
  source: RecallSource,
  entries: RawRecallEntry[],
): RecallContributor {
  return { source, async recall() { return entries; } };
}

function knowledge(id: string, nativeScore: number): RawRecallEntry {
  return {
    source: "knowledge",
    id,
    nativeScore,
    payload: { title: id, preview: id, updated: "2026-04-01" },
  };
}

function memory(id: string, nativeScore: number): RawRecallEntry {
  return {
    source: "memory",
    id,
    nativeScore,
    payload: { preview: id, created: "2026-04-02" },
  };
}

function tasks(id: string, nativeScore: number): RawRecallEntry {
  return {
    source: "tasks",
    id,
    nativeScore,
    payload: { title: id, state: "open", priority: "p2" },
  };
}

function hits(result: RecallResult): RecallHit[] {
  if (!result.ok) throw new Error(`expected recall hits, got ${result.reason}`);
  return result.hits;
}

describe("RecallProviderImpl", () => {
  it("owns semantic availability and returns the public result envelope", async () => {
    const provider = new RecallProviderImpl({ onContributorError: () => {} });
    await expect(provider.recall("query")).resolves.toEqual({
      ok: false,
      reason: "semantic_unavailable",
    });

    provider.register(fixedContributor("knowledge", []));
    await expect(provider.recall("query")).resolves.toEqual({ ok: true, hits: [] });
  });

  it("normalizes per source, merges, and tie-breaks deterministically", async () => {
    const provider = new RecallProviderImpl({ onContributorError: () => {} });
    provider.register(fixedContributor("tasks", [tasks("t1", 9), tasks("t2", 1)]));
    provider.register(fixedContributor("knowledge", [knowledge("k1", 100), knowledge("k2", 50)]));
    provider.register(fixedContributor("memory", [memory("m1", 1)]));

    const first = hits(await provider.recall("query"));
    const second = hits(await provider.recall("query"));
    expect(first).toEqual(second);
    expect(first.map((hit) => `${hit.source}:${hit.id}`)).toEqual([
      "knowledge:k1",
      "memory:m1",
      "tasks:t1",
      "knowledge:k2",
      "tasks:t2",
    ]);
    expect(first.map((hit) => hit.score)).toEqual([1, 1, 1, 0, 0]);
  });

  it("continues with partial results when one contributor fails", async () => {
    const failures: RecallSource[] = [];
    const provider = new RecallProviderImpl({
      onContributorError: (source) => failures.push(source),
    });
    provider.register({
      source: "knowledge",
      async recall() { throw new Error("embedding unavailable"); },
    });
    provider.register(fixedContributor("memory", [memory("m1", 1)]));

    expect(hits(await provider.recall("query")).map((hit) => hit.source)).toEqual([
      "memory",
    ]);
    expect(failures).toEqual(["knowledge"]);
  });

  it("applies source, score, and result-count filters at the owner", async () => {
    const provider = new RecallProviderImpl({ onContributorError: () => {} });
    provider.register(fixedContributor("knowledge", [
      knowledge("k1", 100),
      knowledge("k2", 50),
      knowledge("k3", 0),
    ]));
    provider.register(fixedContributor("memory", [memory("m1", 1)]));

    const result = hits(await provider.recall("query", {
      sources: ["knowledge"],
      minScore: 0.5,
      topK: 2,
    }));
    expect(result.map((hit) => hit.id)).toEqual(["k1", "k2"]);
  });

  it("replaces and withdraws contributors through its registration protocol", async () => {
    const provider = new RecallProviderImpl({ onContributorError: () => {} });
    provider.register(fixedContributor("knowledge", [knowledge("old", 1)]));
    provider.register(fixedContributor("knowledge", [knowledge("new", 1)]));
    expect(hits(await provider.recall("query")).map((hit) => hit.id)).toEqual(["new"]);

    provider.unregister("knowledge");
    expect(provider.contributors()).toEqual([]);
    await expect(provider.recall("query")).resolves.toEqual({
      ok: false,
      reason: "semantic_unavailable",
    });
  });
});
