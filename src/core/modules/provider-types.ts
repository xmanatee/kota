import type { KotaMessage } from "#core/agent-harness/message-protocol.js";
import type { Task, TaskPriority, TaskStatus } from "#core/daemon/task-store.js";
import type { Transport } from "#core/loop/transport.js";

/** A stored conversation message — alias for the core harness message protocol. */
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

/** A memory entry: a persisted agent note with content, tags, and timestamp. */
export type Memory = {
	id: string;
	content: string;
	tags: string[];
	created: string;
};

/** A knowledge base entry: structured markdown with YAML front matter. */
export type KnowledgeEntry = {
	id: string;
	title: string;
	type: string;
	tags: string[];
	status: string;
	created: string;
	updated: string;
	content: string;
	/** Extra metadata fields not covered by the core schema. */
	meta: Record<string, string>;
};

/** Filters for knowledge search and list operations. */
export type SearchFilters = {
	type?: string;
	tag?: string;
	status?: string;
	since?: string;
	scope?: "project" | "global" | "all";
};

/** Result of rebuilding the semantic search index. */
export type ReindexResult = {
	indexed: number;
	failed: number;
	/** Skipped — semantic search not supported by this provider. */
	skipped?: boolean;
};

/** Interface for persistent memory storage (save/search/list/update/delete). */
export interface MemoryProvider {
	save(content: string, tags?: string[]): string;
	search(query: string, options?: { tag?: string; since?: string }): Memory[];
	list(): Memory[];
	update(
		id: string,
		updates: { content?: string; tags?: string[] },
	): boolean;
	delete(id: string): boolean;
	supportsSemanticSearch(): boolean;
	/**
	 * Rank entries by semantic similarity to a natural-language query.
	 * Only embedding-backed providers should return results here.
	 */
	semanticSearch(
		query: string,
		topK: number,
		options?: { tag?: string; since?: string },
	): Promise<Memory[]>;
	/**
	 * Rebuild the semantic index over all entries. Providers without embedding
	 * support return `{ indexed: 0, failed: 0, skipped: true }`.
	 */
	reindex(): Promise<ReindexResult>;
}

/** Interface for structured knowledge storage (CRUD + search over entries). */
export interface KnowledgeProvider {
	create(opts: {
		title: string;
		content: string;
		type?: string;
		tags?: string[];
		status?: string;
		scope?: "project" | "global";
		meta?: Record<string, string>;
	}): string;
	read(id: string): KnowledgeEntry | null;
	update(
		id: string,
		changes: {
			title?: string;
			content?: string;
			type?: string;
			tags?: string[];
			status?: string;
			meta?: Record<string, string>;
		},
	): boolean;
	delete(id: string): boolean;
	search(query: string, filters?: SearchFilters): KnowledgeEntry[];
	list(filters?: SearchFilters): KnowledgeEntry[];
	count(type?: string): number;
	supportsSemanticSearch(): boolean;
	/**
	 * Rank entries by semantic similarity to a natural-language query.
	 * Only embedding-backed providers should return results here.
	 */
	semanticSearch(
		query: string,
		topK: number,
		filters?: SearchFilters,
	): Promise<KnowledgeEntry[]>;
	/**
	 * Rebuild the semantic index over all entries. Providers without embedding
	 * support return `{ indexed: 0, failed: 0, skipped: true }`.
	 */
	reindex(): Promise<ReindexResult>;
}

/** Interface for persistent task storage (add/update/list/get/clear). */
export interface TaskProvider {
	add(
		task: string,
		opts?: {
			parent_id?: number;
			priority?: TaskPriority;
			blocked_by?: number[];
			notes?: string;
		},
	): Task;
	update(
		id: number,
		changes: {
			status?: TaskStatus;
			priority?: TaskPriority;
			blocked_by?: number[];
			notes?: string;
		},
	): Task;
	list(): Task[];
	active(): Task[];
	get(id: number): Task | undefined;
	clear(): void;
	archiveCompleted(): number;
	getActiveSummary(): string | null;
	isEmpty(): boolean;
	count(): number;
}

/**
 * REPL chrome surface — paints operator-facing banners, status, and
 * errors around the interactive transcript. The rendering module
 * supplies the default implementation; core consumers resolve it
 * through `RenderingProvider.createReplChrome()` so `src/core/repl`
 * stays free of rendering-module imports.
 */
export interface ReplChrome {
	/** Announce the chosen harness and model once at REPL entry. */
	announceHarness(harness: { name: string; description: string }, model: string): void;
	/** Print the `/help` table of slash commands and descriptions. */
	showHelp(commands: Record<string, string>): void;
	/** Print the `/status` snapshot (harness, model, turn count). */
	showStatus(harness: string, model: string, turns: number): void;
	/** Confirm a `/reset` or `/clear` of the transcript. */
	showReset(): void;
	/** Paint an error message raised during a turn. */
	showError(message: string): void;
	/** Print the footer on REPL exit. */
	showGoodbye(): void;
}

/**
 * Rendering service — the module-owned seam core uses to paint
 * operator-facing surfaces without importing `#modules/rendering/*`.
 * The rendering module registers a default implementation during
 * `onLoad`; deployments without the rendering module receive `null`
 * from `getRenderingProvider()` and must degrade to a neutral path
 * (e.g. `NullTransport`, a `ReplChrome`-less refusal).
 */
export interface RenderingProvider {
	/** Build the default CLI transport for an agent session. */
	createAgentTransport(options: { verbose: boolean; showCost: boolean }): Transport;
	/** Build the REPL chrome surface used for banners, help, and errors. */
	createReplChrome(): ReplChrome;
}

/** Interface for conversation history storage (create/save/load/list/find/remove). */
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
}
