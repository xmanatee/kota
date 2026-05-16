/** Provider registry — swappable backends for core services. */

import { getTaskStore } from "#core/daemon/task-store.js";
import {
	defineProviderToken,
	type ProviderToken,
} from "./provider-token.js";
import type {
	HistoryProvider,
	KnowledgeProvider,
	MemoryProvider,
	ModelPricingProvider,
	RenderingProvider,
	RepoTasksProvider,
	TaskProvider,
} from "./provider-types.js";


export { defineProviderToken, type ProviderToken } from "./provider-token.js";
export type {
	FlatModelPricing,
	HistoryProvider,
	InputTokenPricingTier,
	InputTokenTieredModelPricing,
	KnowledgeProvider,
	MemoryProvider,
	ModelPricing,
	ModelPricingProvider,
	ModelPricingRates,
	RenderingProvider,
	RepoTasksProvider,
	TaskProvider,
} from "./provider-types.js";

/**
 * Tokens for the cross-cutting providers core itself looks up. Module-
 * domain provider tokens live with their owning module (e.g. the recall
 * module declares `RECALL_PROVIDER_TOKEN`).
 */
export const MEMORY_PROVIDER_TOKEN: ProviderToken<MemoryProvider> =
	defineProviderToken<MemoryProvider>("memory");
export const KNOWLEDGE_PROVIDER_TOKEN: ProviderToken<KnowledgeProvider> =
	defineProviderToken<KnowledgeProvider>("knowledge");
export const HISTORY_PROVIDER_TOKEN: ProviderToken<HistoryProvider> =
	defineProviderToken<HistoryProvider>("history");
export const TASK_PROVIDER_TOKEN: ProviderToken<TaskProvider> =
	defineProviderToken<TaskProvider>("task");
export const REPO_TASKS_PROVIDER_TOKEN: ProviderToken<RepoTasksProvider> =
	defineProviderToken<RepoTasksProvider>("repo-tasks");
export const RENDERING_PROVIDER_TOKEN: ProviderToken<RenderingProvider> =
	defineProviderToken<RenderingProvider>("rendering");
export const MODEL_PRICING_PROVIDER_TOKEN: ProviderToken<ModelPricingProvider> =
	defineProviderToken<ModelPricingProvider>("model-pricing");

type ProviderEntry<T> = {
	name: string;
	provider: T;
};

/** Registry for swappable service providers. Each token can have multiple providers; one is active. */
export class ProviderRegistry {
	/** Map from token id → array of registered providers. */
	private providers = new Map<string, ProviderEntry<unknown>[]>();
	/** Map from token id → name of the active provider. */
	private active = new Map<string, string>();

	/** Register a provider for a token. First registered becomes active by default. */
	register<T>(token: ProviderToken<T>, name: string, provider: T): void {
		let entries = this.providers.get(token);
		if (!entries) {
			entries = [];
			this.providers.set(token, entries);
		}

		// Replace if same name already registered
		const idx = entries.findIndex((e) => e.name === name);
		if (idx >= 0) {
			entries[idx] = { name, provider };
		} else {
			entries.push({ name, provider });
		}

		// First provider becomes default active
		if (!this.active.has(token)) {
			this.active.set(token, name);
		}
	}

	/** Get the active provider for a token. Returns null if none registered. */
	get<T>(token: ProviderToken<T>): T | null {
		const activeName = this.active.get(token);
		if (!activeName) return null;
		return this.getByName(token, activeName);
	}

	/** Get a specific named provider for a token. Returns null if not found. */
	getByName<T>(token: ProviderToken<T>, name: string): T | null {
		const entries = this.providers.get(token);
		if (!entries) return null;
		const entry = entries.find((e) => e.name === name);
		return entry ? (entry.provider as T) : null;
	}

	/** Set the active provider for a token. Returns false if the provider isn't registered. */
	setActive<T>(token: ProviderToken<T>, name: string): boolean {
		const entries = this.providers.get(token);
		if (!entries?.some((e) => e.name === name)) return false;
		this.active.set(token, name);
		return true;
	}

	/** List registered provider names for a token. */
	list<T>(token: ProviderToken<T>): string[] {
		const entries = this.providers.get(token);
		return entries ? entries.map((e) => e.name) : [];
	}

	/** Get the name of the active provider for a token. */
	getActiveName<T>(token: ProviderToken<T>): string | null {
		return this.active.get(token) ?? null;
	}

	/** List all token ids that have registered providers. */
	listTokenIds(): string[] {
		return [...this.providers.keys()];
	}

	/**
	 * Read-only diagnostic snapshot for a token id. Use only for status
	 * surfaces and tooling that want to enumerate the registry without
	 * holding the typed `ProviderToken`. Returns empty arrays / `null`
	 * when the id has no registrations.
	 */
	introspect(id: string): { active: string | null; names: string[] } {
		const entries = this.providers.get(id);
		return {
			active: this.active.get(id) ?? null,
			names: entries ? entries.map((e) => e.name) : [],
		};
	}

	/**
	 * Activate a provider by token id without holding the typed
	 * `ProviderToken`. Used by config-driven activation (`config.providers`)
	 * where the id arrives as a plain string. Returns false if the
	 * provider is not registered.
	 */
	setActiveById(id: string, name: string): boolean {
		const entries = this.providers.get(id);
		if (!entries?.some((e) => e.name === name)) return false;
		this.active.set(id, name);
		return true;
	}

	/** Clear all providers and active selections. */
	clear(): void {
		this.providers.clear();
		this.active.clear();
	}
}

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

/** Register the in-process default stores for core-owned service types. */
export function registerDefaultProviders(): void {
	if (!registry) return;
	registry.register(TASK_PROVIDER_TOKEN, "default", getTaskStore());
}

/**
 * Get the active memory provider from the registry. The `memory` module owns
 * the default implementation — callers must ensure it has loaded (via the
 * module runtime or `ensureCliProvidersFor(["memory"])`).
 */
export function getMemoryProvider(): MemoryProvider {
	if (registry) {
		const provider = registry.get(MEMORY_PROVIDER_TOKEN);
		if (provider) return provider;
	}
	throw new Error(
		"No memory provider registered. Load the `memory` module before calling getMemoryProvider.",
	);
}

/**
 * Get the active knowledge provider from the registry. The `knowledge` module
 * owns the default implementation — callers must ensure it has loaded (via
 * the module runtime or `ensureCliProvidersFor(["knowledge"])`).
 */
export function getKnowledgeProvider(): KnowledgeProvider {
	if (registry) {
		const provider = registry.get(KNOWLEDGE_PROVIDER_TOKEN);
		if (provider) return provider;
	}
	throw new Error(
		"No knowledge provider registered. Load the `knowledge` module before calling getKnowledgeProvider.",
	);
}

/** Get the active task provider, or the default TaskStore when no registry provider is active. */
export function getTaskProvider(): TaskProvider {
	if (registry) {
		const provider = registry.get(TASK_PROVIDER_TOKEN);
		if (provider) return provider;
	}
	return getTaskStore();
}

/**
 * Get the active history provider from the registry. The `history` module
 * owns the default implementation — callers must ensure it has loaded (via
 * the module runtime or `ensureCliProvidersFor(["history"])`).
 */
export function getHistoryProvider(): HistoryProvider {
	if (registry) {
		const provider = registry.get(HISTORY_PROVIDER_TOKEN);
		if (provider) return provider;
	}
	throw new Error(
		"No history provider registered. Load the `history` module before calling getHistoryProvider.",
	);
}

/**
 * Get the active repo-tasks provider from the registry. The `repo-tasks`
 * module owns the default keyword implementation; the `tasks-semantic`
 * module registers an embedding-backed override when configured. Callers
 * must ensure `repo-tasks` has loaded (via the module runtime or
 * `ensureCliProvidersFor(["repo-tasks"])`).
 */
export function getRepoTasksProvider(): RepoTasksProvider {
	if (registry) {
		const provider = registry.get(REPO_TASKS_PROVIDER_TOKEN);
		if (provider) return provider;
	}
	throw new Error(
		"No repo-tasks provider registered. Load the `repo-tasks` module before calling getRepoTasksProvider.",
	);
}

/**
 * Get the active rendering provider from the registry, or `null` when
 * no rendering module is loaded. Unlike history/memory/knowledge, this
 * accessor returns `null` instead of throwing so minimal deployments
 * (daemon-only, headless channels, session pools) can degrade to a
 * neutral fallback — `NullTransport` for the agent stream, a refusal
 * for the interactive REPL — without failing at startup.
 */
export function getRenderingProvider(): RenderingProvider | null {
	if (!registry) return null;
	return registry.get(RENDERING_PROVIDER_TOKEN);
}

/**
 * Get the active model-pricing provider, or `null` when no pricing module is
 * loaded. The model-clients module contributes the default implementation
 * during `onLoad`; deployments without a pricing-providing module receive
 * `null` and the cost tracker contributes $0 for every model — the same
 * unknown-model contract the seam uses per-model. Returning null here
 * preserves the explicit-zero rule end-to-end instead of throwing inside
 * an interactive cost summary.
 */
export function getModelPricingProvider(): ModelPricingProvider | null {
	if (!registry) return null;
	return registry.get(MODEL_PRICING_PROVIDER_TOKEN);
}
