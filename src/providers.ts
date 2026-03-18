/**
 * Provider interfaces and registry — enables swappable backends for core services.
 *
 * Modules can register alternative implementations of MemoryProvider, KnowledgeProvider,
 * TaskProvider, HistoryProvider, etc. The agent resolves the active provider from the
 * registry, falling back to the built-in implementation if no custom provider is configured.
 *
 * Follows the same pattern as SecretProvider (src/secrets.ts) but generalized.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { ConversationData, ConversationRecord } from "./memory/history.js";
import { getHistory } from "./memory/history.js";
import type { KnowledgeEntry, SearchFilters } from "./memory/knowledge-store.js";
import { getKnowledgeStore } from "./memory/knowledge-store.js";
import type { Memory } from "./memory/store.js";
import { getMemoryStore } from "./memory/store.js";
import type { Task, TaskPriority, TaskStatus } from "./scheduler/task-store.js";
import { getTaskStore } from "./scheduler/task-store.js";

// --- Provider interfaces ---

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

// --- Provider registry ---

type ProviderEntry = {
	name: string;
	provider: unknown;
};

/**
 * Registry for swappable service providers.
 *
 * Each service type (e.g., "memory", "knowledge") can have multiple registered
 * providers. One is marked active; the rest are available for switching via config.
 */
export class ProviderRegistry {
	/** Map from service type → array of registered providers. */
	private providers = new Map<string, ProviderEntry[]>();
	/** Map from service type → name of the active provider. */
	private active = new Map<string, string>();

	/** Register a provider for a service type. First registered becomes active by default. */
	register<T>(type: string, name: string, provider: T): void {
		let entries = this.providers.get(type);
		if (!entries) {
			entries = [];
			this.providers.set(type, entries);
		}

		// Replace if same name already registered
		const idx = entries.findIndex((e) => e.name === name);
		if (idx >= 0) {
			entries[idx] = { name, provider };
		} else {
			entries.push({ name, provider });
		}

		// First provider becomes default active
		if (!this.active.has(type)) {
			this.active.set(type, name);
		}
	}

	/** Get the active provider for a service type. Returns null if none registered. */
	get<T>(type: string): T | null {
		const activeName = this.active.get(type);
		if (!activeName) return null;
		return this.getByName<T>(type, activeName);
	}

	/** Get a specific named provider. Returns null if not found. */
	getByName<T>(type: string, name: string): T | null {
		const entries = this.providers.get(type);
		if (!entries) return null;
		const entry = entries.find((e) => e.name === name);
		return entry ? (entry.provider as T) : null;
	}

	/** Set the active provider for a service type. Returns false if the provider isn't registered. */
	setActive(type: string, name: string): boolean {
		const entries = this.providers.get(type);
		if (!entries?.some((e) => e.name === name)) return false;
		this.active.set(type, name);
		return true;
	}

	/** List registered provider names for a service type. */
	list(type: string): string[] {
		const entries = this.providers.get(type);
		return entries ? entries.map((e) => e.name) : [];
	}

	/** Get the name of the active provider for a service type. */
	getActiveName(type: string): string | null {
		return this.active.get(type) ?? null;
	}

	/** List all service types that have registered providers. */
	listTypes(): string[] {
		return [...this.providers.keys()];
	}

	/** Clear all providers and active selections. */
	clear(): void {
		this.providers.clear();
		this.active.clear();
	}
}

// --- Singleton ---

let registry: ProviderRegistry | null = null;

export function initProviderRegistry(): ProviderRegistry {
	registry = new ProviderRegistry();
	return registry;
}

export function getProviderRegistry(): ProviderRegistry | null {
	return registry;
}

export function resetProviderRegistry(): void {
	registry = null;
}

/** Register built-in stores as default providers for all service types. */
export function registerDefaultProviders(cwd?: string): void {
	if (!registry) return;
	registry.register("memory", "default", getMemoryStore());
	registry.register("knowledge", "default", getKnowledgeStore(cwd));
	registry.register("task", "default", getTaskStore());
	registry.register("history", "default", getHistory());
}

// --- Convenience getters with fallback ---

/** Get the active memory provider, falling back to the built-in MemoryStore. */
export function getMemoryProvider(): MemoryProvider {
	if (registry) {
		const provider = registry.get<MemoryProvider>("memory");
		if (provider) return provider;
	}
	return getMemoryStore();
}

/** Get the active knowledge provider, falling back to the built-in KnowledgeStore. */
export function getKnowledgeProvider(cwd?: string): KnowledgeProvider {
	if (registry) {
		const provider = registry.get<KnowledgeProvider>("knowledge");
		if (provider) return provider;
	}
	return getKnowledgeStore(cwd);
}

/** Get the active task provider, falling back to the built-in TaskStore. */
export function getTaskProvider(): TaskProvider {
	if (registry) {
		const provider = registry.get<TaskProvider>("task");
		if (provider) return provider;
	}
	return getTaskStore();
}

/** Get the active history provider, falling back to the built-in ConversationHistory. */
export function getHistoryProvider(): HistoryProvider {
	if (registry) {
		const provider = registry.get<HistoryProvider>("history");
		if (provider) return provider;
	}
	return getHistory();
}
