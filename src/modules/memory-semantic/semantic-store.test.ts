import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStore } from "#modules/memory/store.js";
import { indexPathFor, SemanticIndexFile } from "#modules/semantic-index/semantic-index.js";
import { FakeEmbeddingProvider } from "#modules/semantic-index/test-support.js";
import { SemanticMemoryStore } from "./semantic-store.js";

const roots: string[] = [];

function createStore(): {
  store: SemanticMemoryStore;
  provider: FakeEmbeddingProvider;
  root: string;
} {
  const root = join(tmpdir(), `kota-memory-mapping-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  const provider = new FakeEmbeddingProvider();
  return {
    root,
    provider,
    store: new SemanticMemoryStore({
      base: new MemoryStore(root),
      provider,
      onBackgroundError: () => {},
    }),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SemanticMemoryStore adapter mapping", () => {
  it("fingerprints content and tags and maps their text into the manager", async () => {
    const { store, provider, root } = createStore();
    const id = store.save("bread baking recipe", ["recipe"]);
    await store.flush();
    const before = new SemanticIndexFile(indexPathFor(root)).load(provider.model);

    store.update(id, { content: "monitor spend anomaly", tags: ["budget"] });
    await store.flush();
    const after = new SemanticIndexFile(indexPathFor(root)).load(provider.model);

    expect(after.entries[id].fingerprint).not.toBe(before.entries[id].fingerprint);
    expect(after.entries[id].embedding).not.toEqual(before.entries[id].embedding);
  });

  it("applies memory tag filters before manager ranking", async () => {
    const { store } = createStore();
    const expected = store.save("monitor spend and cost", ["budget"]);
    store.save("monitor spend and cost", ["other"]);
    await store.flush();

    const results = await store.semanticSearch("cost tracking", 5, { tag: "budget" });
    expect(results.map((entry) => entry.id)).toEqual([expected]);
  });
});
