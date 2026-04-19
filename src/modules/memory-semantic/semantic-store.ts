/**
 * SemanticMemoryStore — MemoryProvider variant backed by the shared
 * embedding-index engine. CRUD delegates to the base store; writes enqueue
 * background embed work; queries lazily fill the index, cosine-rank the
 * results, and surface embedding errors to the caller.
 *
 * Memory entries have no `updated` timestamp, so staleness is detected via a
 * content+tags hash fingerprint computed by the adapter.
 */

import { createHash } from "node:crypto";
import type { Memory, MemoryStore } from "#core/memory/store.js";
import type { MemoryProvider } from "#core/modules/provider-types.js";
import type { EmbeddingProvider } from "#modules/semantic-index/embedding-provider.js";
import {
	type ReindexResult,
	SemanticIndexManager,
	type SemanticStoreAdapter,
} from "#modules/semantic-index/semantic-index-manager.js";

export type SemanticMemoryStoreOptions = {
	base: MemoryStore;
	provider: EmbeddingProvider;
	/**
	 * Called when background embedding fails. Defaults to console.error.
	 * Tests override this to assert error handling without polluting output.
	 */
	onBackgroundError?: (err: unknown) => void;
};

function fingerprintMemory(entry: Memory): string {
	const tagKey = [...entry.tags].sort().join(",");
	const hash = createHash("sha1");
	hash.update(entry.content);
	hash.update("\n");
	hash.update(tagKey);
	return hash.digest("hex");
}

function buildAdapter(base: MemoryStore): SemanticStoreAdapter<Memory> {
	const dir = base.getStorageDir();
	return {
		id: (entry) => entry.id,
		fingerprint: fingerprintMemory,
		indexableText: (entry) => {
			const tags = entry.tags.join(" ");
			return `${entry.content}\n${tags}`.trim();
		},
		readEntry: (id) => base.list().find((m) => m.id === id) ?? null,
		resolveStorageDir: () => dir,
		listStorageDirs: () => [dir],
	};
}

export class SemanticMemoryStore implements MemoryProvider {
	private base: MemoryStore;
	private manager: SemanticIndexManager<Memory>;

	constructor(options: SemanticMemoryStoreOptions) {
		this.base = options.base;
		const onError =
			options.onBackgroundError ??
			((err) => console.error("[memory-semantic] background embed failed:", err));
		this.manager = new SemanticIndexManager({
			adapter: buildAdapter(options.base),
			provider: options.provider,
			onError,
		});
	}

	save(content: string, tags: string[] = []): string {
		const id = this.base.save(content, tags);
		this.manager.enqueueEmbed(id);
		return id;
	}

	search(query: string, options?: { tag?: string; since?: string }): Memory[] {
		return this.base.search(query, options);
	}

	list(): Memory[] {
		return this.base.list();
	}

	update(id: string, updates: { content?: string; tags?: string[] }): boolean {
		const ok = this.base.update(id, updates);
		if (ok) this.manager.enqueueEmbed(id);
		return ok;
	}

	delete(id: string): boolean {
		const ok = this.base.delete(id);
		if (ok) this.manager.removeFromIndex(this.base.getStorageDir(), id);
		return ok;
	}

	/** Wait for all pending background embeddings to settle. */
	async flush(): Promise<void> {
		await this.manager.flush();
	}

	supportsSemanticSearch(): boolean {
		return true;
	}

	async semanticSearch(
		query: string,
		topK: number,
		options?: { tag?: string; since?: string },
	): Promise<Memory[]> {
		const filtered = this.base.search("", options);
		return this.manager.rankBySimilarity(query, filtered, topK);
	}

	async reindex(): Promise<ReindexResult> {
		return this.manager.rebuildIndex(this.base.list());
	}
}
