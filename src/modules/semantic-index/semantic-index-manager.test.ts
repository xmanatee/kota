import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexPathFor, SemanticIndexFile } from "./semantic-index.js";
import { SemanticIndexManager, type SemanticStoreAdapter } from "./semantic-index-manager.js";
import { FakeEmbeddingProvider } from "./test-support.js";

type Entry = { id: string; text: string; fingerprint: string; dir: string };

describe("SemanticIndexManager lifecycle", () => {
  let dirs: string[];
  let provider: FakeEmbeddingProvider;
  let entries: Map<string, Entry>;
  let adapter: SemanticStoreAdapter<Entry>;
  let errors: unknown[];
  let manager: SemanticIndexManager<Entry>;

  beforeEach(() => {
    dirs = [0, 1].map(() => mkdtempSync(join(tmpdir(), "kota-semantic-manager-")));
    provider = new FakeEmbeddingProvider();
    entries = new Map();
    errors = [];
    adapter = {
      id: (entry) => entry.id,
      fingerprint: (entry) => entry.fingerprint,
      indexableText: (entry) => entry.text,
      readEntry: (id) => entries.get(id) ?? null,
      listEntries: () => [...entries.values()],
      resolveStorageDir: (id) => entries.get(id)?.dir ?? null,
      listStorageDirs: () => dirs,
    };
    manager = new SemanticIndexManager({ adapter, provider, onError: (error) => errors.push(error) });
  });

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  function add(id: string, text = "monitor cost", dir = dirs[0]): Entry {
    const entry = { id, text, dir, fingerprint: text };
    entries.set(id, entry);
    return entry;
  }

  function persisted(dir = dirs[0]) {
    return new SemanticIndexFile(indexPathFor(dir)).load(provider.model).entries;
  }

  it("persists background updates and reuses their embeddings for queries", async () => {
    const entry = add("cost");
    manager.enqueueEmbed(entry.id);
    await manager.flush();
    expect(persisted()[entry.id].fingerprint).toBe(entry.fingerprint);
    const calls = provider.calls;
    expect(await manager.rankBySimilarity("cost", [entry], 1)).toEqual([entry]);
    expect(await manager.rankBySimilarity("spend", [entry], 1)).toEqual([entry]);
    expect(provider.calls).toBe(calls + 2);
    expect(errors).toEqual([]);
  });

  it.each([new Error("embedding unavailable"), "non-error rejection"])(
    "reports background rejection and continues the queue: %s", async (failure) => {
      const embed = vi.spyOn(provider, "embed").mockRejectedValueOnce(failure);
      const entry = add("cost");
      manager.enqueueEmbed(entry.id);
      await manager.flush();
      expect(errors).toEqual([failure]);
      expect(persisted()[entry.id]).toBeUndefined();
      manager.enqueueEmbed(entry.id);
      await manager.flush();
      expect(persisted()[entry.id].fingerprint).toBe(entry.fingerprint);
      expect(embed).toHaveBeenCalledTimes(2);
    },
  );

  it.each([false, true])("removes only the requested sidecar entry after canonical deletion=%s", async (deleted) => {
    const target = add("target", "cost", dirs[1]);
    const survivor = add("survivor", "bread");
    await manager.reindex();
    expect(persisted(dirs[1])[target.id]).toBeDefined();
    if (deleted) entries.delete(target.id);
    manager.removeFromIndex(target.id);
    expect(persisted(dirs[1])[target.id]).toBeUndefined();
    expect(persisted()[survivor.id].fingerprint).toBe(survivor.fingerprint);
  });

  it("rebuilds canonical entries in every directory and removes stale entries", async () => {
    add("stale");
    await manager.reindex();
    entries.delete("stale");
    const cost = add("cost");
    const bread = add("bread", "bread", dirs[1]);
    expect(await manager.reindex()).toEqual({ indexed: 2, failed: 0 });
    expect(Object.keys(persisted())).toEqual([cost.id]);
    expect(Object.keys(persisted(dirs[1]))).toEqual([bread.id]);
  });

  it("reports partial rebuild failure while indexing the remaining directory", async () => {
    add("failure");
    const survivor = add("survivor", "bread", dirs[1]);
    provider.failNext = true;
    expect(await manager.reindex()).toEqual({ indexed: 1, failed: 1 });
    expect(errors).toEqual([expect.objectContaining({ message: "fake provider failure" })]);
    expect(persisted()).toEqual({});
    expect(persisted(dirs[1])[survivor.id]).toBeDefined();
  });

  it("does no embedding work for an empty rebuild or empty/zero-limit search", async () => {
    expect(await manager.reindex()).toEqual({ indexed: 0, failed: 0 });
    expect(await manager.rankBySimilarity("cost", [], 5)).toEqual([]);
    expect(await manager.rankBySimilarity("cost", [add("cost")], 0)).toEqual([]);
    expect(provider.calls).toBe(0);
  });

  it("lazily indexes candidates and returns ordered, limited scores", async () => {
    const cost = add("cost", "cost spend budget");
    const bread = add("bread", "baking bread");
    const mixed = add("mixed", "cost bread");
    const candidates = [bread, mixed, cost];
    expect(persisted()).toEqual({});
    const scored = await manager.rankBySimilarityScored("cost", candidates, 2);
    expect(scored.map(({ entry }) => entry.id)).toEqual([cost.id, mixed.id]);
    expect(scored[0].score).toBeGreaterThan(scored[1].score);
    expect(scored[1].score).toBeGreaterThan(0);
    expect(Object.keys(persisted()).sort()).toEqual(["bread", "cost", "mixed"]);
  });

  it("replaces a stale fingerprint and embedding when canonical text changes", async () => {
    const initial = add("entry", "baking bread");
    await manager.rankBySimilarity("bread", [initial], 1);
    const before = persisted()[initial.id];
    const updated = add(initial.id, "monitor cost");
    expect(await manager.rankBySimilarity("cost", [updated], 1)).toEqual([updated]);
    const after = persisted()[updated.id];
    expect(after.fingerprint).toBe(updated.fingerprint);
    expect(after.embedding).not.toEqual(before.embedding);
  });

  it("propagates query failure instead of reporting an empty successful result", async () => {
    const entry = add("cost");
    await manager.reindex();
    provider.failNext = true;
    await expect(manager.rankBySimilarity("cost", [entry], 1)).rejects.toThrow("fake provider failure");
    expect(errors).toEqual([expect.objectContaining({ message: "fake provider failure" })]);
  });
});
