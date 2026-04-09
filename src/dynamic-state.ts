/**
 * Dynamic State Registry — per-turn system-prompt contributions from modules.
 *
 * Modules register a synchronous string provider via ctx.registerDynamicStateProvider().
 * Each agent turn, loop-send.ts calls collectDynamicState() to gather all contributions
 * and append them to the dynamic system-prompt block.
 *
 * This decouples the core turn loop from specific store modules: the loop iterates
 * registered providers instead of importing capability modules directly.
 */

type StateProvider = () => string;

type ProviderEntry = {
	name: string;
	fn: StateProvider;
};

const providers: ProviderEntry[] = [];

/**
 * Register a per-turn state string provider.
 * The function is called synchronously on every agent turn.
 * Throws if a provider with the same name is already registered.
 */
export function registerDynamicStateProvider(name: string, fn: StateProvider): void {
	if (providers.some((p) => p.name === name)) {
		throw new Error(`Dynamic state provider already registered: "${name}"`);
	}
	providers.push({ name, fn });
}

/**
 * Collect and concatenate output from all registered state providers.
 * Returns empty string when no providers are registered.
 */
export function collectDynamicState(): string {
	return providers.map((p) => p.fn()).join("");
}

/** Reset all registered providers — for testing. */
export function resetDynamicStateProviders(): void {
	providers.length = 0;
}
