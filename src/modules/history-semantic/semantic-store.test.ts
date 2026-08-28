import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	HISTORY_PROVIDER_TOKEN,
	initProviderRegistry,
	resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { runConversationRecall } from "#modules/history/conversation-recall.js";
import { ConversationHistory } from "#modules/history/history.js";
import {
	indexPathFor,
	SemanticIndexFile,
} from "#modules/semantic-index/semantic-index.js";
import { FakeEmbeddingProvider } from "#modules/semantic-index/test-support.js";
import { SemanticHistoryStore } from "./semantic-store.js";

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

	it("declares all four semantic capabilities", () => {
		expect(store.capabilities).toEqual({
			mutation: true,
			deletion: true,
			reindex: true,
			search: true,
		});
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

	it("re-embeds when a conversation is updated with new messages", async () => {
		const id = store.create("claude-haiku", "/tmp/p");
		store.save(id, [{ role: "user", content: "bread baking recipe" }], 0, 0);
		await store.flush();

		const sidecar = new SemanticIndexFile(indexPathFor(storeDir));
		const before = sidecar.load(provider.model);
		const embBefore = [...before.entries[id].embedding];
		const fpBefore = before.entries[id].fingerprint;

		await new Promise((r) => setTimeout(r, 5));
		store.save(
			id,
			[{ role: "user", content: "monitor spend and cost anomaly" }],
			0,
			0,
		);
		await store.flush();

		const after = sidecar.load(provider.model);
		expect(after.entries[id].embedding).not.toEqual(embBefore);
		expect(after.entries[id].fingerprint).not.toBe(fpBefore);
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

	it("reindexes conversations using manager", async () => {
		saveConversation(store, "monitor spend");
		saveConversation(store, "baking bread");
		await store.flush();

		const result = await store.reindex();
		expect(result.indexed).toBe(2);
		expect(result.failed).toBe(0);
	});

	it("filters semantic candidates by cwd and source options", async () => {
		const here = saveConversation(store, "monitor spend and cost", "/tmp/here");
		saveConversation(store, "monitor spend and cost", "/tmp/elsewhere");
		await store.flush();

		const results = await store.semanticSearch("cost tracking", 5, {
			cwd: "/tmp/here",
		});
		expect(results.map((r) => r.id)).toEqual([here]);
	});

	it("delegates non-semantic operations to base ConversationHistory", () => {
		const id = saveConversation(store, "some text about budgeting");
		expect(store.list({ search: "budgeting" }).map((r) => r.id)).toContain(id);
		expect(store.findByPrefix(id.slice(0, 8))?.id).toBe(id);
		expect(store.getMostRecent()?.id).toBe(id);
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
		registry.register(HISTORY_PROVIDER_TOKEN, "history-semantic", semantic);
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
		const firstIdMatch = result.content!.match(/\[([^\]]+)\]/);
		expect(firstIdMatch?.[1]).toBe(costId);
	});

	it("falls back to the keyword list when no provider supports semantic search", async () => {
		resetProviderRegistry();
		const registry = initProviderRegistry();
		registry.register(HISTORY_PROVIDER_TOKEN, "default", base);

		const id = saveConversation(base, "Help me fix the authentication bug");
		const result = await runConversationRecall({
			action: "search",
			query: "authentication",
		});
		expect(result.content).toContain(id);
	});
});
