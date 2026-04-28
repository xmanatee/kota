import { describe, expect, it } from "vitest";
import { RecallProviderImpl } from "./recall-provider.js";
import type {
  RawRecallEntry,
  RecallContributor,
  RecallSource,
} from "./recall-types.js";
import { createRecallToolRunner, recallTool } from "./tool.js";

function fixedContributor(
  source: RecallSource,
  hits: RawRecallEntry[],
): RecallContributor {
  return { source, async recall() { return hits; } };
}

function knowledgeHit(id: string, nativeScore: number): RawRecallEntry {
  return {
    source: "knowledge",
    id,
    nativeScore,
    payload: { title: `Title ${id}`, preview: `preview-${id}`, updated: "2026-04-01" },
  };
}

function memoryHit(id: string, nativeScore: number): RawRecallEntry {
  return {
    source: "memory",
    id,
    nativeScore,
    payload: { preview: `mem-preview-${id}`, created: "2026-04-02" },
  };
}

describe("recall tool — schema", () => {
  it("declares a JSON schema with `query` required and every recall source enumerated", () => {
    expect(recallTool.name).toBe("recall");
    expect(recallTool.input_schema.required).toEqual(["query"]);
    const props = recallTool.input_schema.properties as Record<string, unknown>;
    expect(props.query).toBeDefined();
    const sources = (props.sources as { items: { enum: string[] } }).items;
    expect(sources.enum).toEqual([
      "knowledge",
      "memory",
      "history",
      "tasks",
      "answer",
    ]);
  });
});

describe("recall tool — runner success arms", () => {
  it("renders hits across multiple sources via the shared plain-text renderer", async () => {
    const provider = new RecallProviderImpl({ onContributorError: () => {} });
    provider.register(fixedContributor("knowledge", [knowledgeHit("k1", 0.9)]));
    provider.register(fixedContributor("memory", [memoryHit("m1", 0.8)]));
    const runner = createRecallToolRunner(() => provider);

    const result = await runner({ query: "anything" });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("knowledge");
    expect(result.content).toContain("k1");
    expect(result.content).toContain("Title k1");
    expect(result.content).toContain("memory");
    expect(result.content).toContain("m1");
  });

  it("forwards filter fields (topK, minScore, sources) onto the provider call", async () => {
    let receivedFilter: unknown;
    const provider = new RecallProviderImpl({ onContributorError: () => {} });
    provider.register({
      source: "knowledge",
      async recall(_query, options) {
        receivedFilter = options;
        return [knowledgeHit("k1", 0.9)];
      },
    });
    provider.register(fixedContributor("memory", [memoryHit("m1", 0.5)]));
    const runner = createRecallToolRunner(() => provider);

    const result = await runner({
      query: "anything",
      topK: 5,
      minScore: 0.1,
      sources: ["knowledge"],
    });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("k1");
    expect(result.content).not.toContain("m1");
    expect(receivedFilter).toEqual({ topK: 5 });
  });
});

describe("recall tool — runner failure arms", () => {
  it("returns an error result and the operator-friendly empty body when no hits match", async () => {
    const provider = new RecallProviderImpl({ onContributorError: () => {} });
    provider.register(fixedContributor("knowledge", []));
    const runner = createRecallToolRunner(() => provider);

    const result = await runner({ query: "no-match" });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toBe("No matching hits.");
  });

  it("rejects an invalid `sources` element with a typed error before reaching the provider", async () => {
    const provider = new RecallProviderImpl({ onContributorError: () => {} });
    provider.register(fixedContributor("knowledge", [knowledgeHit("k1", 0.5)]));
    const runner = createRecallToolRunner(() => provider);

    const result = await runner({ query: "x", sources: ["knowledge", "bogus"] });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("`sources` must be a list of");
  });

  it("returns an error result when the seam has no registered contributors", async () => {
    const provider = new RecallProviderImpl({ onContributorError: () => {} });
    const runner = createRecallToolRunner(() => provider);

    const result = await runner({ query: "x" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("no registered contributors");
  });
});
