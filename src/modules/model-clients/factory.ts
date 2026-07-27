/**
 * Provider factory — resolves a ModelClient from CLI flags, config, setup
 * secrets, and env-backed secret providers.
 *
 * Supports provider/model notation `<provider>/<model>` (e.g.
 * `ollama/<model>`, `openai/<model>`, `openrouter/<model>`) and explicit
 * --provider / --base-url flags. Provider selection is explicit: callers must
 * pass a provider, use provider/model notation, or configure modelProvider.type.
 */

import type { KotaConfig } from "#core/config/config.js";
import { getProjectSecretStore } from "#core/config/secrets.js";
import type { ModelClient, ProviderFactoryOptions, ResolvedProvider } from "#core/model/model-client.js";
import { AnthropicModelClient } from "./anthropic.js";
import { FailoverModelClient } from "./failover-client.js";
import { OpenAIModelClient } from "./openai/client.js";
import { resolveOpenAIModelCapabilities } from "./openrouter-capabilities.js";
import {
	anthropicThinkingTranslator,
	type EffortTranslator,
	openaiReasoningEffortTranslator,
	openrouterReasoningEffortTranslator,
} from "./reasoning.js";

/**
 * Known provider presets. `effortTranslator` is the per-preset reasoning
 * mapping; presets without one throw loudly when a caller sets `effort`
 * rather than silently dropping it to the provider's default budget.
 */
export const PROVIDER_PRESETS: Record<
	string,
	{ baseUrl: string; apiKeyEnv: string; effortTranslator?: EffortTranslator }
> = {
	openai: {
		baseUrl: "https://api.openai.com/v1",
		apiKeyEnv: "OPENAI_API_KEY",
		effortTranslator: openaiReasoningEffortTranslator,
	},
	"anthropic-oai": {
		baseUrl: "https://api.anthropic.com/v1",
		apiKeyEnv: "ANTHROPIC_API_KEY",
		effortTranslator: anthropicThinkingTranslator,
	},
	ollama: { baseUrl: "http://localhost:11434/v1", apiKeyEnv: "" },
	groq: {
		baseUrl: "https://api.groq.com/openai/v1",
		apiKeyEnv: "GROQ_API_KEY",
	},
	together: {
		baseUrl: "https://api.together.xyz/v1",
		apiKeyEnv: "TOGETHER_API_KEY",
	},
	openrouter: {
		baseUrl: "https://openrouter.ai/api/v1",
		apiKeyEnv: "OPENROUTER_API_KEY",
		effortTranslator: openrouterReasoningEffortTranslator,
	},
	lmstudio: { baseUrl: "http://localhost:1234/v1", apiKeyEnv: "" },
};

export type ModelClientSecretResolver = (key: string) => string | null;

type SecretResolutionOptions = {
	projectDir?: string;
	secretResolver?: ModelClientSecretResolver;
};

/** Parse "provider/model" notation. Returns just the model if no slash. */
export function parseModelString(model: string): {
	provider?: string;
	model: string;
} {
	const slash = model.indexOf("/");
	if (slash > 0) {
		return { provider: model.slice(0, slash), model: model.slice(slash + 1) };
	}
	return { model };
}

function lookupSecret(
	key: string,
	options: SecretResolutionOptions = {},
): string {
	const injected = options.secretResolver?.(key);
	if (injected) return injected;
	return getProjectSecretStore(options.projectDir ?? process.cwd()).get(key) ?? "";
}

function resolveSecretReference(
	raw: string,
	options: SecretResolutionOptions = {},
): string {
	if (!raw.startsWith("$")) return raw;
	return lookupSecret(raw.slice(1), options);
}

export function apiKeyNameForProvider(providerName: string): string {
	if (providerName === "anthropic") return "ANTHROPIC_API_KEY";
	const preset = PROVIDER_PRESETS[providerName];
	if (preset?.apiKeyEnv) return preset.apiKeyEnv;
	return providerName === "ollama" || providerName === "lmstudio"
		? ""
		: "OPENAI_API_KEY";
}

export function resolveModelProviderName(
	model: string,
	explicitProvider?: string,
): string | undefined {
	return explicitProvider || parseModelString(model).provider;
}

function requireModelProviderName(opts: ProviderFactoryOptions): string {
	const providerName = resolveModelProviderName(opts.model, opts.provider);
	if (providerName) return providerName;
	throw new Error(
		`Model provider is not configured for "${opts.model}". ` +
			`Use provider/model notation (for example "openrouter/openrouter/auto" ` +
			`or "openai/${opts.model}") or set modelProvider.type.`,
	);
}

/** Resolve the API key for a given provider from explicit config, setup secrets, or env-backed providers. */
export function resolveApiKey(
	providerName: string,
	explicit?: string,
	options: SecretResolutionOptions = {},
): string {
	if (explicit) return resolveSecretReference(explicit, options);
	const keyName = apiKeyNameForProvider(providerName);
	return keyName ? lookupSecret(keyName, options) : "";
}

function createClientForProvider(
	providerName: string,
	model: string,
	baseUrl?: string,
	apiKey?: string,
	options: SecretResolutionOptions = {},
): ModelClient {
	if (providerName === "anthropic") {
		const resolvedKey = resolveApiKey(providerName, apiKey, options);
		return new AnthropicModelClient({
			maxRetries: 5,
			...(resolvedKey ? { apiKey: resolvedKey } : {}),
		});
	}

	const preset = PROVIDER_PRESETS[providerName];
	const resolvedBaseUrl = baseUrl || preset?.baseUrl;
	if (!resolvedBaseUrl) {
		throw new Error(
			`Unknown provider "${providerName}" and no --base-url specified.\n\n` +
				`Known providers: anthropic, ${Object.keys(PROVIDER_PRESETS).join(", ")}\n` +
				"Or pass --base-url for any OpenAI-compatible endpoint.",
		);
	}

	const resolvedKey = resolveApiKey(providerName, apiKey, options);
	const modelCapabilities = resolveOpenAIModelCapabilities(providerName, model);
	return new OpenAIModelClient({
		baseUrl: resolvedBaseUrl,
		apiKey: resolvedKey,
		presetName: providerName,
		...(modelCapabilities !== undefined ? { modelCapabilities } : {}),
		...(preset?.effortTranslator
			? { effortTranslator: preset.effortTranslator }
			: {}),
	});
}

let activeFailoverClient: FailoverModelClient | null = null;

export function getActiveFailoverClient(): FailoverModelClient | null {
	return activeFailoverClient;
}

/**
 * Create a ModelClient from combined CLI + config signals.
 *
 * Resolution order:
 * 1. Explicit `provider` flag
 * 2. Provider prefix in model string ("ollama/llama3")
 * 3. Throw when provider is not configured
 */
export function createModelClientImpl(
	opts: ProviderFactoryOptions,
): ResolvedProvider {
	const parsed = parseModelString(opts.model);
	const providerName = requireModelProviderName(opts);
	const model = parsed.model;

	const primary = createClientForProvider(
		providerName,
		model,
		opts.baseUrl,
		opts.apiKey,
		opts,
	);

	return {
		client: primary,
		model,
		providerName,
	};
}

const DEFAULT_ERROR_THRESHOLD = 5;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_COOLDOWN_MS = 300_000;

export function createModelClientWithFailover(
	opts: ProviderFactoryOptions,
	failoverConfig: NonNullable<KotaConfig["failover"]>,
): ResolvedProvider {
	const parsed = parseModelString(opts.model);
	const providerName = requireModelProviderName(opts);
	const model = parsed.model;

	const primary = createClientForProvider(
		providerName,
		model,
		opts.baseUrl,
		opts.apiKey,
		opts,
	);
	const fallback = createClientForProvider(
		failoverConfig.provider,
		model,
		failoverConfig.baseUrl,
		failoverConfig.apiKey,
		opts,
	);

	const failoverClient = new FailoverModelClient({
		primary,
		fallback,
		primaryName: providerName,
		fallbackName: failoverConfig.provider,
		errorThreshold: failoverConfig.errorThreshold ?? DEFAULT_ERROR_THRESHOLD,
		windowMs: failoverConfig.windowMs ?? DEFAULT_WINDOW_MS,
		cooldownMs: failoverConfig.cooldownMs ?? DEFAULT_COOLDOWN_MS,
	});

	activeFailoverClient = failoverClient;

	return {
		client: failoverClient,
		model,
		providerName,
	};
}
