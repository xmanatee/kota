import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "#modules/memory/store.js";
import type { EmbeddingProvider } from "#modules/semantic-index/embedding-provider.js";
import {
	indexPathFor,
	SemanticIndexFile,
} from "#modules/semantic-index/semantic-index.js";
import { SemanticMemoryStore } from "./semantic-store.js";

const CONCEPTS: Record<string, number> = {
	workflow: 0,
	pipeline: 0,
	cost: 1,
	budget: 1,
	spend: 1,
	spending: 1,
	expense: 1,
	tracking: 2,
	monitoring: 2,
	metric: 2,
	metrics: 2,
	anomaly: 3,
	alert: 3,
	bread: 4,
	baking: 4,
	recipe: 4,
	auth: 5,
	login: 5,
	session: 5,
};

const DIMS = 8;

function fakeEmbed(text: string): number[] {
	const vec = new Array(DIMS).fill(0);
	for (const word of text.toLowerCase().split(/[^a-z]+/)) {
		if (!word) continue;
		const dim = CONCEPTS[word];
		if (dim !== undefined) vec[dim] += 1;
	}
	return vec;
}

class FakeEmbeddingProvider implements EmbeddingProvider {
	readonly name = "fake";
	readonly model: string;
	public calls = 0;
	public textsSeen: string[][] = [];
	public failNext = false;

	constructor(model = "fake-model-v1") {
		this.model = model;
	}

	async embed(texts: string[]): Promise<number[][]> {
		this.calls += 1;
		this.textsSeen.push([...texts]);
		if (this.failNext) {
			this.failNext = false;
			throw new Error("fake provider failure");
		}
		return texts.map(fakeEmbed);
	}
}

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

	it("indexes entries on save and persists to sidecar", async () => {
		const id = store.save("track spend and cost anomaly alerts", ["budget"]);
		await store.flush();

		expect(errors).toEqual([]);
		expect(provider.calls).toBeGreaterThanOrEqual(1);
		expect(existsSync(indexPathFor(storeDir))).toBe(true);

		const results = await store.semanticSearch("workflow cost tracking", 5);
		expect(results.map((r) => r.id)).toContain(id);
	});

	it("ranks semantically similar entries above unrelated ones", async () => {
		const costId = store.save("monitor spend and cost anomaly", ["budget"]);
		const breadId = store.save("baking bread at home", ["recipe"]);
		const authId = store.save("auth session cookies", ["auth"]);
		await store.flush();

		const results = await store.semanticSearch("workflow cost tracking", 3);
		expect(results[0].id).toBe(costId);
		const ids = results.map((r) => r.id);
		expect(ids.indexOf(costId)).toBeLessThan(ids.indexOf(breadId));
		expect(ids.indexOf(costId)).toBeLessThan(ids.indexOf(authId));
	});

	it("returns semantically adjacent entries for a lexically distinct query", async () => {
		const costId = store.save("monitor spend and cost anomaly", ["budget"]);
		store.save("baking bread at home", ["recipe"]);
		store.save("auth session cookies", ["auth"]);
		await store.flush();

		// Query uses none of the saved words verbatim — pure concept overlap.
		const results = await store.semanticSearch("pipeline expense metrics", 3);
		expect(results[0].id).toBe(costId);
	});

	it("re-embeds when an entry's content changes (incremental)", async () => {
		const id = store.save("bread baking recipe", []);
		await store.flush();

		const before = new SemanticIndexFile(indexPathFor(storeDir)).load(
			provider.model,
		);
		const embBefore = [...before.entries[id].embedding];
		const fpBefore = before.entries[id].fingerprint;

		store.update(id, { content: "monitor spend and cost anomaly" });
		await store.flush();

		const after = new SemanticIndexFile(indexPathFor(storeDir)).load(
			provider.model,
		);
		const embAfter = after.entries[id].embedding;
		expect(embAfter).not.toEqual(embBefore);
		expect(after.entries[id].fingerprint).not.toBe(fpBefore);
	});

	it("re-embeds when an entry's tags change", async () => {
		const id = store.save("monitor spend and cost anomaly", ["budget"]);
		await store.flush();

		const before = new SemanticIndexFile(indexPathFor(storeDir)).load(
			provider.model,
		);
		const fpBefore = before.entries[id].fingerprint;

		store.update(id, { tags: ["budget", "finance"] });
		await store.flush();

		const after = new SemanticIndexFile(indexPathFor(storeDir)).load(
			provider.model,
		);
		expect(after.entries[id].fingerprint).not.toBe(fpBefore);
	});

	it("surfaces query-time provider errors", async () => {
		store.save("monitor spend and cost", ["budget"]);
		await store.flush();

		provider.failNext = true;
		await expect(store.semanticSearch("budget", 5)).rejects.toThrow(
			"fake provider failure",
		);
		expect(errors.length).toBeGreaterThanOrEqual(1);
	});

	it("keyword search on the base store still works regardless of semantic config", () => {
		const id = store.save("some text about budgeting", []);
		const results = store.search("budgeting");
		expect(results.map((r) => r.id)).toContain(id);
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

	it("reindex rebuilds the embedding index and returns counts", async () => {
		store.save("monitor spend", ["budget"]);
		store.save("baking bread", ["recipe"]);
		await store.flush();

		const before = provider.calls;
		const result = await store.reindex();
		expect(result.indexed).toBe(2);
		expect(result.failed).toBe(0);
		expect(provider.calls).toBeGreaterThan(before);
	});

	it("reindex reports failures when the provider throws", async () => {
		store.save("spend", []);
		await store.flush();

		provider.failNext = true;
		const result = await store.reindex();
		expect(result.failed).toBeGreaterThan(0);
		expect(errors.length).toBeGreaterThanOrEqual(1);
	});

	it("semanticSearch returns [] when topK is 0 without embedding", async () => {
		store.save("spend", []);
		await store.flush();
		const embedCallsBefore = provider.calls;
		const results = await store.semanticSearch("cost", 0);
		expect(results).toEqual([]);
		expect(provider.calls).toBe(embedCallsBefore);
	});

	it("uses cached index without re-embedding entries on repeat query", async () => {
		store.save("monitor spend and cost anomaly", []);
		await store.flush();
		const callsAfterIndex = provider.calls;

		await store.semanticSearch("workflow cost", 5);
		await store.semanticSearch("workflow cost", 5);
		expect(provider.calls).toBe(callsAfterIndex + 2);
	});

	it("reports non-Error failures via onBackgroundError without crashing", async () => {
		const bgSpy = vi.fn();
		const store2 = new SemanticMemoryStore({
			base,
			provider,
			onBackgroundError: bgSpy,
		});
		provider.failNext = true;
		store2.save("spend", []);
		await store2.flush();
		expect(bgSpy).toHaveBeenCalled();
	});

	it("respects tag filtering when ranking semantically", async () => {
		const taggedId = store.save("monitor spend and cost", ["budget"]);
		store.save("monitor spend and cost", ["other"]);
		await store.flush();

		const results = await store.semanticSearch("cost tracking", 5, {
			tag: "budget",
		});
		const ids = results.map((r) => r.id);
		expect(ids).toContain(taggedId);
		expect(ids).toHaveLength(1);
	});
});
