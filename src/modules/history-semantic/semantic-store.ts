/**
 * SemanticHistoryStore — HistoryProvider variant backed by the shared
 * embedding-index engine. Read/mutation methods delegate to the base
 * `ConversationHistory`; writes enqueue background embed work; semantic
 * queries lazily fill the index, cosine-rank the results, and surface
 * embedding errors to the caller.
 *
 * Staleness is detected via each conversation record's `updatedAt` ISO
 * timestamp, which the base store already bumps on every save.
 */

import type { KotaMessage } from "#core/agent-harness/message-protocol.js";
import type {
	ConversationData,
	ConversationMessage,
	ConversationRecord,
	HistoryProvider,
	HistorySemanticOptions,
	ReindexResult,
} from "#core/modules/provider-types.js";
import type { ConversationHistory } from "#modules/history/history.js";
import type { EmbeddingProvider } from "#modules/semantic-index/embedding-provider.js";
import {
	SemanticIndexManager,
	type SemanticStoreAdapter,
} from "#modules/semantic-index/semantic-index-manager.js";

export type SemanticHistoryStoreOptions = {
	base: ConversationHistory;
	provider: EmbeddingProvider;
	/**
	 * Called when background embedding fails. Defaults to console.error.
	 * Tests override this to assert error handling without polluting output.
	 */
	onBackgroundError?: (err: unknown) => void;
};

/** Maximum conversations considered when applying filters before semantic ranking. */
const SEMANTIC_CANDIDATE_LIMIT = 1000;

function extractMessageText(content: KotaMessage["content"]): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (block.type === "text") parts.push(block.text);
	}
	return parts.join(" ");
}

function buildIndexableText(
	record: ConversationRecord,
	data: ConversationData | null,
): string {
	const parts: string[] = [record.title];
	if (data) {
		for (const msg of data.messages) {
			if (msg.role !== "user" && msg.role !== "assistant") continue;
			const text = extractMessageText(msg.content);
			if (text) parts.push(text);
		}
	}
	return parts.join("\n").trim();
}

function buildAdapter(
	base: ConversationHistory,
): SemanticStoreAdapter<ConversationRecord> {
	const dir = base.getStorageDir();
	return {
		id: (record) => record.id,
		fingerprint: (record) => record.updatedAt,
		indexableText: (record) => buildIndexableText(record, base.load(record.id)),
		readEntry: (id) => {
			try {
				return base.findByPrefix(id);
			} catch {
				return null;
			}
		},
		resolveStorageDir: () => dir,
		listStorageDirs: () => [dir],
	};
}

export class SemanticHistoryStore implements HistoryProvider {
	private base: ConversationHistory;
	private manager: SemanticIndexManager<ConversationRecord>;

	constructor(options: SemanticHistoryStoreOptions) {
		this.base = options.base;
		const onError =
			options.onBackgroundError ??
			((err) => console.error("[history-semantic] background embed failed:", err));
		this.manager = new SemanticIndexManager({
			adapter: buildAdapter(options.base),
			provider: options.provider,
			onError,
		});
	}

	create(model: string, cwd: string, source?: "user" | "action"): string {
		return this.base.create(model, cwd, source);
	}

	save(
		id: string,
		messages: ConversationMessage[],
		compactionCount: number,
		lastInputTokens: number,
	): void {
		this.base.save(id, messages, compactionCount, lastInputTokens);
		this.manager.enqueueEmbed(id);
	}

	load(id: string): ConversationData | null {
		return this.base.load(id);
	}

	list(opts?: {
		search?: string;
		limit?: number;
		cwd?: string;
		source?: "user" | "action";
	}): ConversationRecord[] {
		return this.base.list(opts);
	}

	getMostRecent(cwd?: string): ConversationRecord | null {
		return this.base.getMostRecent(cwd);
	}

	findByPrefix(idOrPrefix: string): ConversationRecord | null {
		return this.base.findByPrefix(idOrPrefix);
	}

	remove(id: string): boolean {
		const ok = this.base.remove(id);
		if (ok) this.manager.removeFromIndex(this.base.getStorageDir(), id);
		return ok;
	}

	cleanup(): number {
		return this.base.cleanup();
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
		options?: HistorySemanticOptions,
	): Promise<ConversationRecord[]> {
		const candidates = this.base.list({
			limit: SEMANTIC_CANDIDATE_LIMIT,
			cwd: options?.cwd,
			source: options?.source,
		});
		return this.manager.rankBySimilarity(query, candidates, topK);
	}

	async reindex(): Promise<ReindexResult> {
		const all = this.base.list({ limit: SEMANTIC_CANDIDATE_LIMIT });
		return this.manager.rebuildIndex(all);
	}
}
