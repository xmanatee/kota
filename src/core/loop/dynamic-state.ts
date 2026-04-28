/**
 * Dynamic State Registry — per-turn system-prompt contributions from modules.
 *
 * Modules register a synchronous string provider via ctx.registerDynamicStateProvider().
 * Each agent turn, loop-send.ts calls collectDynamicState() with the active tool set;
 * providers may use that set to gate their output (e.g. the capture/recall/answer
 * modules omit their conversational-pattern blocks when the matching tool is not
 * in the session's effective tool policy). The registry concatenates all
 * contributions and the loop appends them to the dynamic system-prompt block.
 *
 * This decouples the core turn loop from specific store modules: the loop iterates
 * registered providers instead of importing capability modules directly.
 */

/**
 * Per-turn context passed to every registered provider.
 *
 * `activeTools` is the effective set of tools the agent can call this turn,
 * i.e. the names of tools after group filtering and `allowedTools` /
 * `disallowedTools` gating. Providers should use it to suppress guidance for
 * tools that are not admitted, so the system prompt does not instruct the
 * agent to use a tool it cannot reach.
 */
export type DynamicStateContext = {
	activeTools: ReadonlySet<string>;
};

type StateProvider = (ctx: DynamicStateContext) => string;

type ProviderEntry = {
	name: string;
	fn: StateProvider;
};

const providers: ProviderEntry[] = [];

/**
 * Register a per-turn state string provider.
 * The function is called synchronously on every agent turn with the active
 * tool set for the turn. Throws if a provider with the same name is already
 * registered.
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
export function collectDynamicState(ctx: DynamicStateContext): string {
	return providers.map((p) => p.fn(ctx)).join("");
}

/** Reset all registered providers — for testing. */
export function resetDynamicStateProviders(): void {
	providers.length = 0;
}
