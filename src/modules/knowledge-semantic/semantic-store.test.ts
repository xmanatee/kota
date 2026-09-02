import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeStore } from "#modules/knowledge/store.js";
import { indexPathFor, SemanticIndexFile } from "#modules/semantic-index/semantic-index.js";
import { FakeEmbeddingProvider } from "#modules/semantic-index/test-support.js";
import { SemanticKnowledgeStore } from "./semantic-store.js";

const roots: string[] = [];

function createStore() {
  const scopeRoot = join(tmpdir(), `kota-knowledge-mapping-${crypto.randomUUID()}`);
  const globalDir = join(tmpdir(), `kota-knowledge-global-${crypto.randomUUID()}`);
  mkdirSync(scopeRoot, { recursive: true });
  mkdirSync(globalDir, { recursive: true });
  roots.push(scopeRoot, globalDir);
  const provider = new FakeEmbeddingProvider();
  return {
    scopeRoot,
    globalDir,
    provider,
    store: new SemanticKnowledgeStore({
      base: new KnowledgeStore(scopeRoot, globalDir),
      provider,
      onBackgroundError: () => {},
    }),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SemanticKnowledgeStore adapter mapping", () => {
  it("uses entry timestamps as fingerprints in the entry-owned sidecar", async () => {
    const { store, provider, scopeRoot } = createStore();
    const id = store.create({ title: "Budget", content: "bread recipe", scope: "scope" });
    await store.flush();
    const sidecar = new SemanticIndexFile(indexPathFor(join(scopeRoot, ".kota", "data")));
    const before = sidecar.load(provider.model);

    await new Promise((resolve) => setTimeout(resolve, 2));
    store.update(id, { content: "monitor spend anomaly" });
    await store.flush();
    const after = sidecar.load(provider.model);

    expect(after.entries[id].fingerprint).not.toBe(before.entries[id].fingerprint);
  });

  it("maps scope and tag filters before manager ranking", async () => {
    const { store } = createStore();
    const expected = store.create({
      title: "Scope note",
      content: "monitor spend and cost",
      tags: ["budget"],
      scope: "scope",
    });
    store.create({
      title: "Global note",
      content: "monitor spend and cost",
      tags: ["other"],
      scope: "global",
    });
    await store.flush();

    const results = await store.semanticSearch("cost", 5, {
      tag: "budget",
      scope: "scope",
    });
    expect(results.map((entry) => entry.id)).toEqual([expected]);
  });
});
