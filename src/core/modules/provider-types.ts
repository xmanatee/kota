import type Anthropic from "@anthropic-ai/sdk";
import type { ConversationData, ConversationRecord } from "#core/memory/history.js";
import type { KnowledgeEntry, SearchFilters } from "#core/memory/knowledge-store.js";
import type { Memory } from "#core/memory/store.js";
import type { Task, TaskPriority, TaskStatus } from "#core/daemon/task-store.js";

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

/** Interface for conversation history storage (create/save/load/list/find/remove). */
export interface HistoryProvider {
	create(model: string, cwd: string, source?: "user" | "action"): string;
	save(
		id: string,
		messages: Anthropic.MessageParam[],
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
