import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	initProviderRegistry,
	resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { runConversationRecall } from "#modules/history/conversation-recall.js";
import { ConversationHistory } from "#modules/history/history.js";
import type { EmbeddingProvider } from "#modules/semantic-index/embedding-provider.js";
import {
	indexPathFor,
	SemanticIndexFile,
} from "#modules/semantic-index/semantic-index.js";
import { SemanticHistoryStore } from "./semantic-store.js";

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
		`kota-hist-sem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

type SaveTarget = {
	create(model: string, cwd: string): string;
	save(
		id: string,
		messages: { role: "user"; content: string }[],
		compactionCount: number,
		lastInputTokens: number,
	): void;
};

function saveConversation(
	history: SaveTarget,
	text: string,
	cwd = "/tmp/test",
): string {
	const id = history.create("claude-haiku", cwd);
	history.save(id, [{ role: "user", content: text }], 0, 0);
	return id;
}

describe("SemanticHistoryStore", () => {
	let storeDir: string;
	let base: ConversationHistory;
	let provider: FakeEmbeddingProvider;
	let store: SemanticHistoryStore;
	let errors: unknown[];

	beforeEach(() => {
		storeDir = makeTmpDir();
		base = new ConversationHistory(storeDir);
		provider = new FakeEmbeddingProvider();
		errors = [];
		store = new SemanticHistoryStore({
			base,
			provider,
			onBackgroundError: (e) => errors.push(e),
		});
	});

	afterEach(() => {
		rmSync(storeDir, { recursive: true, force: true });
	});

	it("indexes conversations on save and persists to sidecar", async () => {
		const id = store.create("claude-haiku", "/tmp/p");
		store.save(
			id,
			[{ role: "user", content: "track spend and cost anomaly alerts" }],
			0,
			0,
		);
		await store.flush();

		expect(errors).toEqual([]);
		expect(provider.calls).toBeGreaterThanOrEqual(1);
		expect(existsSync(indexPathFor(storeDir))).toBe(true);

		const results = await store.semanticSearch("workflow cost tracking", 5);
		expect(results.map((r) => r.id)).toContain(id);
	});

	it("ranks semantically similar conversations above unrelated ones", async () => {
		const costId = store.create("claude-haiku", "/tmp/p");
		store.save(
			costId,
			[{ role: "user", content: "monitor spend and cost anomaly" }],
			0,
			0,
		);
		const breadId = store.create("claude-haiku", "/tmp/p");
		store.save(
			breadId,
			[{ role: "user", content: "baking bread at home" }],
			0,
			0,
		);
		const authId = store.create("claude-haiku", "/tmp/p");
		store.save(
			authId,
			[{ role: "user", content: "auth session cookies" }],
			0,
			0,
		);
		await store.flush();

		const results = await store.semanticSearch("workflow cost tracking", 3);
		expect(results[0].id).toBe(costId);
		const ids = results.map((r) => r.id);
		expect(ids.indexOf(costId)).toBeLessThan(ids.indexOf(breadId));
		expect(ids.indexOf(costId)).toBeLessThan(ids.indexOf(authId));
	});

	it("returns the right conversation for a lexically distinct query — substring would miss", async () => {
		const costId = saveConversation(
			store,
			"monitor spend and cost anomaly",
		);
		saveConversation(store, "baking bread at home");
		saveConversation(store, "auth session cookies");
		await store.flush();

		// Substring match against a query that uses none of the saved words.
		const substringHits = base.list({ search: "pipeline expense metrics" });
		expect(substringHits).toEqual([]);

		// Semantic match returns the conceptually-related conversation at rank 1.
		const semantic = await store.semanticSearch("pipeline expense metrics", 3);
		expect(semantic[0].id).toBe(costId);
	});

	it("re-embeds when a conversation is updated (incremental)", async () => {
		const id = store.create("claude-haiku", "/tmp/p");
		store.save(id, [{ role: "user", content: "bread baking recipe" }], 0, 0);
		await store.flush();

		const before = new SemanticIndexFile(indexPathFor(storeDir)).load(
			provider.model,
		);
		const embBefore = [...before.entries[id].embedding];
		const fpBefore = before.entries[id].fingerprint;

		// Subsequent save bumps updatedAt and replaces the embedded message.
		await new Promise((r) => setTimeout(r, 5));
		store.save(
			id,
			[{ role: "user", content: "monitor spend and cost anomaly" }],
			0,
			0,
		);
		await store.flush();

		const after = new SemanticIndexFile(indexPathFor(storeDir)).load(
			provider.model,
		);
		const embAfter = after.entries[id].embedding;
		expect(embAfter).not.toEqual(embBefore);
		expect(after.entries[id].fingerprint).not.toBe(fpBefore);
	});

	it("surfaces query-time provider errors", async () => {
		saveConversation(store, "monitor spend and cost");
		await store.flush();

		provider.failNext = true;
		await expect(store.semanticSearch("budget", 5)).rejects.toThrow(
			"fake provider failure",
		);
		expect(errors.length).toBeGreaterThanOrEqual(1);
	});

	it("keyword list still works regardless of semantic config", () => {
		const id = saveConversation(store, "some text about budgeting");
		const results = store.list({ search: "budgeting" });
		expect(results.map((r) => r.id)).toContain(id);
	});

	it("removes deleted conversations from the sidecar index", async () => {
		const id = saveConversation(store, "monitor spend");
		await store.flush();

		const before = await store.semanticSearch("cost", 5);
		expect(before.map((r) => r.id)).toContain(id);

		store.remove(id);
		const after = await store.semanticSearch("cost", 5);
		expect(after.map((r) => r.id)).not.toContain(id);
	});

	it("reindex rebuilds the embedding index and returns counts", async () => {
		saveConversation(store, "monitor spend");
		saveConversation(store, "baking bread");
		await store.flush();

		const before = provider.calls;
		const result = await store.reindex();
		expect(result.indexed).toBe(2);
		expect(result.failed).toBe(0);
		expect(provider.calls).toBeGreaterThan(before);
	});

	it("reindex reports failures when the provider throws", async () => {
		saveConversation(store, "spend");
		await store.flush();

		provider.failNext = true;
		const result = await store.reindex();
		expect(result.failed).toBeGreaterThan(0);
		expect(errors.length).toBeGreaterThanOrEqual(1);
	});

	it("semanticSearch returns [] when topK is 0 without embedding", async () => {
		saveConversation(store, "spend");
		await store.flush();
		const before = provider.calls;
		const results = await store.semanticSearch("cost", 0);
		expect(results).toEqual([]);
		expect(provider.calls).toBe(before);
	});

	it("filters semantic candidates by cwd when requested", async () => {
		const here = saveConversation(store, "monitor spend and cost", "/tmp/here");
		saveConversation(store, "monitor spend and cost", "/tmp/elsewhere");
		await store.flush();

		const results = await store.semanticSearch("cost tracking", 5, {
			cwd: "/tmp/here",
		});
		expect(results.map((r) => r.id)).toEqual([here]);
	});

	it("reports non-Error failures via onBackgroundError without crashing", async () => {
		const bgSpy = vi.fn();
		const store2 = new SemanticHistoryStore({
			base,
			provider,
			onBackgroundError: bgSpy,
		});
		provider.failNext = true;
		const id = store2.create("claude-haiku", "/tmp/p");
		store2.save(id, [{ role: "user", content: "spend" }], 0, 0);
		await store2.flush();
		expect(bgSpy).toHaveBeenCalled();
	});
});

describe("conversation_recall through the semantic provider", () => {
	let storeDir: string;
	let base: ConversationHistory;
	let semantic: SemanticHistoryStore;

	beforeEach(() => {
		storeDir = makeTmpDir();
		base = new ConversationHistory(storeDir);
		const provider = new FakeEmbeddingProvider();
		semantic = new SemanticHistoryStore({
			base,
			provider,
			onBackgroundError: () => {},
		});
		const registry = initProviderRegistry();
		registry.register("history", "history-semantic", semantic);
	});

	afterEach(() => {
		resetProviderRegistry();
		rmSync(storeDir, { recursive: true, force: true });
	});

	it("returns the conceptually relevant conversation when substring would miss", async () => {
		const costId = saveConversation(
			semantic,
			"monitor spend and cost anomaly",
		);
		saveConversation(semantic, "baking bread at home");
		saveConversation(semantic, "auth session cookies");
		await semantic.flush();

		const result = await runConversationRecall({
			action: "search",
			query: "pipeline expense metrics",
			limit: 3,
		});

		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain(costId);
		// Cost conversation is the first id mentioned (rank 1).
		const firstIdMatch = result.content!.match(/\[([^\]]+)\]/);
		expect(firstIdMatch?.[1]).toBe(costId);
	});

	it("falls back to the keyword list when no provider supports semantic search", async () => {
		resetProviderRegistry();
		const registry = initProviderRegistry();
		registry.register("history", "default", base);

		const id = saveConversation(base, "Help me fix the authentication bug");
		const result = await runConversationRecall({
			action: "search",
			query: "authentication",
		});
		expect(result.content).toContain(id);
	});
});
