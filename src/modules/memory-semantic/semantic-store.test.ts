import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "#modules/memory/store.js";
import {
	indexPathFor,
	SemanticIndexFile,
} from "#modules/semantic-index/semantic-index.js";
import { FakeEmbeddingProvider } from "#modules/semantic-index/test-support.js";
import { SemanticMemoryStore } from "./semantic-store.js";

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`kota-mem-sem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("SemanticMemoryStore", () => {
	let storeDir: string;
	let base: MemoryStore;
	let provider: FakeEmbeddingProvider;
	let store: SemanticMemoryStore;
	let errors: unknown[];

	beforeEach(() => {
		storeDir = makeTmpDir();
		base = new MemoryStore(storeDir);
		provider = new FakeEmbeddingProvider();
		errors = [];
		store = new SemanticMemoryStore({
			base,
			provider,
			onBackgroundError: (e) => errors.push(e),
		});
	});

	afterEach(() => {
		rmSync(storeDir, { recursive: true, force: true });
	});

	it("declares all four semantic capabilities", () => {
		expect(store.capabilities).toEqual({
			mutation: true,
			deletion: true,
			reindex: true,
			search: true,
		});
	});

	it("indexes entries on save and persists to sidecar", async () => {
		const id = store.save("track spend and cost anomaly alerts", ["budget"]);
		await store.flush();

		expect(errors).toEqual([]);
		expect(provider.calls).toBeGreaterThanOrEqual(1);
		expect(existsSync(indexPathFor(storeDir))).toBe(true);

		const results = await store.semanticSearch("workflow cost tracking", 5);
		expect(results.map((r) => r.id)).toContain(id);
	});

	it("re-embeds when an entry's content or tags change", async () => {
		const id = store.save("bread baking recipe", ["recipe"]);
		await store.flush();

		const sidecar = new SemanticIndexFile(indexPathFor(storeDir));
		const before = sidecar.load(provider.model);
		const embBefore = [...before.entries[id].embedding];
		const fpBefore = before.entries[id].fingerprint;

		store.update(id, { content: "monitor spend and cost anomaly", tags: ["budget"] });
		await store.flush();

		const after = sidecar.load(provider.model);
		expect(after.entries[id].embedding).not.toEqual(embBefore);
		expect(after.entries[id].fingerprint).not.toBe(fpBefore);
	});

	it("removes deleted entries from the sidecar index", async () => {
		const id = store.save("monitor spend", []);
		await store.flush();

		const before = await store.semanticSearch("cost", 5);
		expect(before.map((r) => r.id)).toContain(id);

		store.delete(id);
		const after = await store.semanticSearch("cost", 5);
		expect(after.map((r) => r.id)).not.toContain(id);
	});

	it("reindexes memory entries using manager", async () => {
		store.save("monitor spend", ["budget"]);
		store.save("baking bread", ["recipe"]);
		await store.flush();

		const result = await store.reindex();
		expect(result.indexed).toBe(2);
		expect(result.failed).toBe(0);
	});

	it("respects tag and since filtering during semantic search", async () => {
		const taggedId = store.save("monitor spend and cost", ["budget"]);
		store.save("monitor spend and cost", ["other"]);
		await store.flush();

		const results = await store.semanticSearch("cost tracking", 5, {
			tag: "budget",
		});
		expect(results.map((r) => r.id)).toEqual([taggedId]);
	});

	it("keyword search and list delegate directly to base store", () => {
		const id = store.save("some text about budgeting", ["finance"]);
		expect(store.search("budgeting").map((r) => r.id)).toContain(id);
		expect(store.list().map((r) => r.id)).toContain(id);
	});
});
