import { describe, expect, it } from "vitest";
import type { KnowledgeProvider } from "#core/modules/provider-types.js";
import { createKnowledgeReadinessSource } from "./capability-readiness.js";

function stubProvider(supportsSemantic: boolean): KnowledgeProvider {
  return {
    create: () => "id",
    read: () => null,
    update: () => false,
    delete: () => false,
    search: () => [],
    list: () => [],
    count: () => 0,
    supportsSemanticSearch: () => supportsSemantic,
    semanticSearch: async () => [],
    reindex: async () => ({ indexed: 0, failed: 0 }),
  };
}

describe("createKnowledgeReadinessSource", () => {
  it("reports both keyword and semantic readiness when semantic is supported", async () => {
    const source = createKnowledgeReadinessSource(stubProvider(true));
    const reports = await source.probe();
    expect(reports.map((r) => r.id)).toEqual([
      "knowledge.search",
      "knowledge.semantic_search",
    ]);
    expect(reports.every((r) => r.status === "ready")).toBe(true);
  });

  it("marks semantic_search unavailable with the embedding_unsupported reason", async () => {
    const source = createKnowledgeReadinessSource(stubProvider(false));
    const reports = await source.probe();
    const semantic = reports.find((r) => r.id === "knowledge.semantic_search");
    expect(semantic?.status).toBe("unavailable");
    expect(semantic?.reason).toBe("embedding_unsupported");
    expect(semantic?.message).toMatch(/knowledge-semantic/);
  });
});
