/** Provider registry — swappable backends for core services. */

import { getTaskStore } from "#core/daemon/task-store.js";
import type {
	HistoryProvider,
	KnowledgeProvider,
	MemoryProvider,
	TaskProvider,
} from "./provider-types.js";

export type { HistoryProvider, KnowledgeProvider, MemoryProvider, TaskProvider } from "./provider-types.js";

type ProviderEntry = {
	name: string;
	provider: unknown;
};

/** Registry for swappable service providers. Each service type can have multiple providers; one is active. */
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
	registry.register("task", "default", getTaskStore());
}

/**
 * Get the active memory provider from the registry. The `memory` module owns
 * the default implementation — callers must ensure it has loaded (via the
 * module runtime or `ensureCliProvidersFor(["memory"])`).
 */
export function getMemoryProvider(): MemoryProvider {
	if (registry) {
		const provider = registry.get<MemoryProvider>("memory");
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
		const provider = registry.get<KnowledgeProvider>("knowledge");
		if (provider) return provider;
	}
	throw new Error(
		"No knowledge provider registered. Load the `knowledge` module before calling getKnowledgeProvider.",
	);
}

/** Get the active task provider, or the default TaskStore when no registry provider is active. */
export function getTaskProvider(): TaskProvider {
	if (registry) {
		const provider = registry.get<TaskProvider>("task");
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
		const provider = registry.get<HistoryProvider>("history");
		if (provider) return provider;
	}
	throw new Error(
		"No history provider registered. Load the `history` module before calling getHistoryProvider.",
	);
}
