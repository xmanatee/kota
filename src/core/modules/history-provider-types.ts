import type { KotaMessage } from '#core/agent-harness/message-protocol.js';
import type { ReindexResult } from './work-provider-types.js';

export type ConversationMessage = KotaMessage;

/** Summary record for a persisted conversation in history. */
export type ConversationRecord = {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	model: string;
	messageCount: number;
	cwd: string;
	/** Distinguishes user-initiated conversations from internal non-user sessions. */
	source?: "user" | "action";
};

/** Full persisted conversation state: summary plus messages and compaction metadata. */
export type ConversationData = {
	record: ConversationRecord;
	messages: ConversationMessage[];
	compactionCount: number;
	lastInputTokens: number;
};

export type HistorySemanticOptions = {
	cwd?: string;
	source?: "user" | "action";
};

export interface HistoryProvider {
	create(model: string, cwd: string, source?: "user" | "action"): string;
	save(
		id: string,
		messages: ConversationMessage[],
		compactionCount: number,
		lastInputTokens: number,
	): void;
	load(id: string): ConversationData | null;
	list(opts?: {
		search?: string;
		limit?: number;
		cwd?: string;
		source?: "user" | "action";
	}): ConversationRecord[];
	getMostRecent(cwd?: string): ConversationRecord | null;
	findByPrefix(idOrPrefix: string): ConversationRecord | null;
	remove(id: string): boolean;
	cleanup(): number;
	supportsSemanticSearch(): boolean;
	/**
	 * Rank conversations by semantic similarity to a natural-language query.
	 * Only embedding-backed providers should return results here.
	 */
	semanticSearch(
		query: string,
		topK: number,
		options?: HistorySemanticOptions,
	): Promise<ConversationRecord[]>;
	/**
	 * Rebuild the semantic index over all conversations. Providers without
	 * embedding support return `{ indexed: 0, failed: 0, skipped: true }`.
	 */
	reindex(): Promise<ReindexResult>;
}
