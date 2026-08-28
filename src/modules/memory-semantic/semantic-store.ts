/**
 * SemanticMemoryStore — MemoryProvider variant backed by the shared
 * embedding-index engine. CRUD delegates to the base store; writes enqueue
 * background embed work; queries lazily fill the index, cosine-rank the
 * results, and surface embedding errors to the caller.
 *
 * The indexable memory text is still content+tags. Provenance/freshness stays
 * canonical in the base store and is read from the returned entry, not from the
 * semantic sidecar.
 */

import { createHash } from "node:crypto";
import type {
	Memory,
	MemoryProvider,
	MemorySemanticSearchCapability,
} from "#core/modules/provider-types.js";
import { printTerminalDiagnostic } from "#core/modules/terminal-renderer.js";
import type { MemoryStore } from "#modules/memory/store.js";
import type { EmbeddingProvider } from "#modules/semantic-index/embedding-provider.js";
import {
	type ReindexResult,
	SemanticIndexManager,
	type SemanticStoreAdapter,
	type SemanticStoreCapabilities,
} from "#modules/semantic-index/semantic-index-manager.js";

export type SemanticMemoryStoreOptions = {
	base: MemoryStore;
	provider: EmbeddingProvider;
	/**
	 * Called when background embedding fails. Defaults to a terminal diagnostic.
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
		capabilities: {
			mutation: true,
			deletion: true,
			reindex: true,
			search: true,
		},
		id: (entry) => entry.id,
		fingerprint: fingerprintMemory,
		indexableText: (entry) => {
			const tags = entry.tags.join(" ");
			return `${entry.content}\n${tags}`.trim();
		},
		readEntry: (id) => base.list().find((m) => m.id === id) ?? null,
		listEntries: () => base.list(),
		resolveStorageDir: () => dir,
		listStorageDirs: () => [dir],
	};
}

export class SemanticMemoryStore implements MemoryProvider, MemorySemanticSearchCapability {
	readonly capabilities: SemanticStoreCapabilities;
	readonly semanticSearchCapability: MemorySemanticSearchCapability = this;
	private base: MemoryStore;
	private manager: SemanticIndexManager<Memory>;

	constructor(options: SemanticMemoryStoreOptions) {
		this.base = options.base;
		const onError =
			options.onBackgroundError ??
			((err) =>
				printTerminalDiagnostic(
					"[memory-semantic] background embed failed:",
					"error",
					err instanceof Error ? err.message : String(err),
				));
		this.manager = new SemanticIndexManager({
			adapter: buildAdapter(options.base),
			provider: options.provider,
			onError,
		});
		this.capabilities = this.manager.capabilities;
	}

	save(
		content: string,
		tags: string[] = [],
		metadata?: Parameters<MemoryProvider["save"]>[2],
	): string {
		const id = this.base.save(content, tags, metadata);
		this.manager.enqueueEmbed(id);
		return id;
	}

	search(query: string, options?: { tag?: string; since?: string }): Memory[] {
		return this.base.search(query, options);
	}

	list(): Memory[] {
		return this.base.list();
	}

	update(
		id: string,
		updates: Parameters<MemoryProvider["update"]>[1],
	): boolean {
		const ok = this.base.update(id, updates);
		if (ok) this.manager.enqueueEmbed(id);
		return ok;
	}

	delete(id: string): boolean {
		const ok = this.base.delete(id);
		if (ok) this.manager.removeFromIndex(id);
		return ok;
	}

	/** Wait for all pending background embeddings to settle. */
	async flush(): Promise<void> {
		await this.manager.flush();
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
		return this.manager.reindex();
	}
}
