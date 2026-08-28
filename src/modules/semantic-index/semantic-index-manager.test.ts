import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	indexPathFor,
	SemanticIndexFile,
} from "./semantic-index.js";
import {
	SemanticIndexManager,
	type SemanticStoreAdapter,
} from "./semantic-index-manager.js";
import { FakeEmbeddingProvider } from "./test-support.js";

type TestEntry = {
	id: string;
	text: string;
	fingerprint: string;
	dir?: string;
};

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`kota-sem-mgr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("SemanticIndexManager lifecycle", () => {
	let storeDir: string;
	let secondaryDir: string;
	let provider: FakeEmbeddingProvider;
	let entriesMap: Map<string, TestEntry>;
	let adapter: SemanticStoreAdapter<TestEntry>;
	let errors: unknown[];
	let manager: SemanticIndexManager<TestEntry>;

	beforeEach(() => {
		storeDir = makeTmpDir();
		secondaryDir = makeTmpDir();
		provider = new FakeEmbeddingProvider();
		entriesMap = new Map();
		errors = [];

		adapter = {
			id: (e) => e.id,
			fingerprint: (e) => e.fingerprint,
			indexableText: (e) => e.text,
			readEntry: (id) => entriesMap.get(id) ?? null,
			listEntries: () => Array.from(entriesMap.values()),
			resolveStorageDir: (id) => {
				const entry = entriesMap.get(id);
				return entry ? (entry.dir ?? storeDir) : null;
			},
			listStorageDirs: () => [storeDir, secondaryDir],
		};

		manager = new SemanticIndexManager({
			adapter,
			provider,
			onError: (err) => errors.push(err),
		});
	});

	afterEach(() => {
		rmSync(storeDir, { recursive: true, force: true });
		rmSync(secondaryDir, { recursive: true, force: true });
	});

	describe("capabilities resolution", () => {
		it("defaults all capabilities to true", () => {
			expect(manager.capabilities).toEqual({
				mutation: true,
				deletion: true,
				reindex: true,
				search: true,
			});
		});

		it("merges adapter and manager capability overrides", () => {
			const readOnlyManager = new SemanticIndexManager({
				adapter: {
					...adapter,
					capabilities: { mutation: false, deletion: false },
				},
				provider,
				onError: () => {},
				capabilities: { reindex: false },
			});
			expect(readOnlyManager.capabilities).toEqual({
				mutation: false,
				deletion: false,
				reindex: false,
				search: true,
			});
		});
	});

	describe("mutation lifecycle", () => {
		it("enqueues background embed and persists to sidecar", async () => {
			const entry: TestEntry = {
				id: "item-1",
				text: "monitor spend and cost anomaly alerts",
				fingerprint: "fp-1",
			};
			entriesMap.set(entry.id, entry);

			manager.enqueueEmbed(entry.id);
			await manager.flush();

			expect(errors).toEqual([]);
			expect(provider.calls).toBeGreaterThanOrEqual(1);
			expect(existsSync(indexPathFor(storeDir))).toBe(true);

			const file = new SemanticIndexFile(indexPathFor(storeDir));
			const loaded = file.load(provider.model);
			expect(loaded.entries["item-1"]).toBeDefined();
			expect(loaded.entries["item-1"].fingerprint).toBe("fp-1");
		});

		it("ignores enqueueEmbed when mutation capability is disabled", async () => {
			const noMutationManager = new SemanticIndexManager({
				adapter,
				provider,
				onError: () => {},
				capabilities: { mutation: false },
			});
			const entry: TestEntry = { id: "item-1", text: "spend", fingerprint: "fp-1" };
			entriesMap.set(entry.id, entry);

			noMutationManager.enqueueEmbed(entry.id);
			await noMutationManager.flush();

			expect(provider.calls).toBe(0);
		});

		it("routes background Error failures to onError without throwing unhandled rejection", async () => {
			const entry: TestEntry = { id: "item-err", text: "spend", fingerprint: "fp-1" };
			entriesMap.set(entry.id, entry);
			provider.failNext = true;

			manager.enqueueEmbed(entry.id);
			await manager.flush();

			expect(errors.length).toBe(1);
			expect((errors[0] as Error).message).toBe("fake provider failure");
		});

		it("routes non-Error background failures to onError without crashing", async () => {
			const throwingProvider = {
				name: "thrower",
				model: "throw-v1",
				embed: vi.fn().mockRejectedValue("string-error-payload"),
			};
			const storeWithThrower = new SemanticIndexManager({
				adapter,
				provider: throwingProvider,
				onError: (err) => errors.push(err),
			});
			const entry: TestEntry = { id: "item-str-err", text: "spend", fingerprint: "fp-1" };
			entriesMap.set(entry.id, entry);

			storeWithThrower.enqueueEmbed(entry.id);
			await storeWithThrower.flush();

			expect(errors).toEqual(["string-error-payload"]);
		});
	});

	describe("deletion lifecycle", () => {
		it("removes an entry from the sidecar index by id", async () => {
			const entry: TestEntry = { id: "item-del", text: "monitor spend", fingerprint: "fp-1" };
			entriesMap.set(entry.id, entry);
			manager.enqueueEmbed(entry.id);
			await manager.flush();

			const before = new SemanticIndexFile(indexPathFor(storeDir)).load(provider.model);
			expect(before.entries["item-del"]).toBeDefined();

			entriesMap.delete(entry.id);
			manager.removeFromIndex(entry.id);

			const after = new SemanticIndexFile(indexPathFor(storeDir)).load(provider.model);
			expect(after.entries["item-del"]).toBeUndefined();
		});

		it("removes an entry across storage dirs when resolveStorageDir returns null", async () => {
			const entry: TestEntry = {
				id: "item-sweep",
				text: "cost budget",
				fingerprint: "fp-1",
				dir: secondaryDir,
			};
			entriesMap.set(entry.id, entry);
			manager.enqueueEmbed(entry.id);
			await manager.flush();

			const secFile = new SemanticIndexFile(indexPathFor(secondaryDir)).load(provider.model);
			expect(secFile.entries["item-sweep"]).toBeDefined();

			entriesMap.delete(entry.id);
			// adapter.resolveStorageDir will now return storeDir default, but sweep cleans secondaryDir too
			manager.removeFromIndex(entry.id);

			const secAfter = new SemanticIndexFile(indexPathFor(secondaryDir)).load(provider.model);
			expect(secAfter.entries["item-sweep"]).toBeUndefined();
		});

		it("ignores removeFromIndex when deletion capability is disabled", async () => {
			const noDeletionManager = new SemanticIndexManager({
				adapter,
				provider,
				onError: () => {},
				capabilities: { deletion: false },
			});
			const entry: TestEntry = { id: "item-nodelete", text: "spend", fingerprint: "fp-1" };
			entriesMap.set(entry.id, entry);
			manager.enqueueEmbed(entry.id);
			await manager.flush();

			noDeletionManager.removeFromIndex(entry.id);

			const loaded = new SemanticIndexFile(indexPathFor(storeDir)).load(provider.model);
			expect(loaded.entries["item-nodelete"]).toBeDefined();
		});
	});

	describe("reindex lifecycle", () => {
		it("rebuilds index across storage directories and returns counts", async () => {
			const e1: TestEntry = { id: "e1", text: "cost spend", fingerprint: "fp-1", dir: storeDir };
			const e2: TestEntry = { id: "e2", text: "baking bread", fingerprint: "fp-2", dir: secondaryDir };
			entriesMap.set(e1.id, e1);
			entriesMap.set(e2.id, e2);

			const result = await manager.reindex();
			expect(result).toEqual({ indexed: 2, failed: 0 });

			const idx1 = new SemanticIndexFile(indexPathFor(storeDir)).load(provider.model);
			expect(idx1.entries.e1).toBeDefined();

			const idx2 = new SemanticIndexFile(indexPathFor(secondaryDir)).load(provider.model);
			expect(idx2.entries.e2).toBeDefined();
		});

		it("returns { indexed: 0, failed: 0 } when entries list is empty", async () => {
			const result = await manager.reindex([]);
			expect(result).toEqual({ indexed: 0, failed: 0 });
		});

		it("reports provider errors and tallies failed counts during reindex", async () => {
			const e1: TestEntry = { id: "e1", text: "spend", fingerprint: "fp-1" };
			entriesMap.set(e1.id, e1);
			provider.failNext = true;

			const result = await manager.reindex();
			expect(result.failed).toBe(1);
			expect(result.indexed).toBe(0);
			expect(errors.length).toBe(1);
		});

		it("returns { indexed: 0, failed: 0 } when reindex capability is disabled", async () => {
			const noReindexManager = new SemanticIndexManager({
				adapter,
				provider,
				onError: () => {},
				capabilities: { reindex: false },
			});
			const e1: TestEntry = { id: "e1", text: "spend", fingerprint: "fp-1" };
			entriesMap.set(e1.id, e1);

			const result = await noReindexManager.reindex();
			expect(result).toEqual({ indexed: 0, failed: 0 });
			expect(provider.calls).toBe(0);
		});
	});

	describe("search and ranking lifecycle", () => {
		it("ranks entries by cosine similarity and slices to topK", async () => {
			const cost: TestEntry = { id: "cost", text: "monitor spend and cost anomaly", fingerprint: "fp-cost" };
			const bread: TestEntry = { id: "bread", text: "baking bread at home", fingerprint: "fp-bread" };
			const auth: TestEntry = { id: "auth", text: "auth session cookies", fingerprint: "fp-auth" };
			entriesMap.set(cost.id, cost);
			entriesMap.set(bread.id, bread);
			entriesMap.set(auth.id, auth);

			const ranked = await manager.rankBySimilarity("workflow cost tracking", [cost, bread, auth], 2);
			expect(ranked).toHaveLength(2);
			expect(ranked[0].id).toBe("cost");
		});

		it("returns scored entries with rankBySimilarityScored", async () => {
			const cost: TestEntry = { id: "cost", text: "monitor spend and cost anomaly", fingerprint: "fp-cost" };
			entriesMap.set(cost.id, cost);

			const scored = await manager.rankBySimilarityScored("workflow cost", [cost], 5);
			expect(scored).toHaveLength(1);
			expect(scored[0].entry.id).toBe("cost");
			expect(scored[0].score).toBeGreaterThan(0);
		});

		it("returns empty array when topK <= 0 or entries is empty without calling provider", async () => {
			const cost: TestEntry = { id: "cost", text: "spend", fingerprint: "fp-1" };
			const callsBefore = provider.calls;

			expect(await manager.rankBySimilarity("cost", [cost], 0)).toEqual([]);
			expect(await manager.rankBySimilarity("cost", [], 5)).toEqual([]);
			expect(provider.calls).toBe(callsBefore);
		});

		it("lazily indexes missing entries on search", async () => {
			const e1: TestEntry = { id: "e1", text: "monitor budget and cost", fingerprint: "fp-1" };
			entriesMap.set(e1.id, e1);

			const sidecar = new SemanticIndexFile(indexPathFor(storeDir));
			expect(sidecar.load(provider.model).entries.e1).toBeUndefined();

			const results = await manager.rankBySimilarity("cost", [e1], 5);
			expect(results.map((r) => r.id)).toContain("e1");

			expect(sidecar.load(provider.model).entries.e1).toBeDefined();
		});

		it("lazily re-embeds stale entries when fingerprint changes", async () => {
			const e1: TestEntry = { id: "e1", text: "baking bread recipe", fingerprint: "fp-v1" };
			entriesMap.set(e1.id, e1);
			await manager.rankBySimilarity("bread", [e1], 5);

			const sidecar = new SemanticIndexFile(indexPathFor(storeDir));
			const embBefore = sidecar.load(provider.model).entries.e1.embedding;

			// Update entry text and fingerprint
			const e1Updated: TestEntry = { id: "e1", text: "monitor spend and cost anomaly", fingerprint: "fp-v2" };
			entriesMap.set(e1.id, e1Updated);

			await manager.rankBySimilarity("cost", [e1Updated], 5);
			const embAfter = sidecar.load(provider.model).entries.e1.embedding;
			expect(embAfter).not.toEqual(embBefore);
		});

		it("reuses in-memory cache on repeat queries without re-embedding entries", async () => {
			const e1: TestEntry = { id: "e1", text: "monitor spend and cost", fingerprint: "fp-1" };
			entriesMap.set(e1.id, e1);
			manager.enqueueEmbed(e1.id);
			await manager.flush();

			const callsAfterEmbed = provider.calls;
			await manager.rankBySimilarity("cost", [e1], 5);
			await manager.rankBySimilarity("spend", [e1], 5);

			// Only the 2 query embeddings should be called
			expect(provider.calls).toBe(callsAfterEmbed + 2);
		});

		it("surfaces query-time provider errors to caller and calls onError", async () => {
			const e1: TestEntry = { id: "e1", text: "spend", fingerprint: "fp-1" };
			entriesMap.set(e1.id, e1);
			manager.enqueueEmbed(e1.id);
			await manager.flush();

			provider.failNext = true;
			await expect(manager.rankBySimilarity("cost", [e1], 5)).rejects.toThrow("fake provider failure");
			expect(errors.length).toBeGreaterThanOrEqual(1);
		});

		it("returns empty array when search capability is disabled", async () => {
			const noSearchManager = new SemanticIndexManager({
				adapter,
				provider,
				onError: () => {},
				capabilities: { search: false },
			});
			const e1: TestEntry = { id: "e1", text: "spend", fingerprint: "fp-1" };
			entriesMap.set(e1.id, e1);

			const results = await noSearchManager.rankBySimilarity("cost", [e1], 5);
			expect(results).toEqual([]);
		});
	});
});
