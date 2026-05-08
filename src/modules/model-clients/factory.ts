/**
 * Provider factory — resolves a ModelClient from CLI flags, config, and env vars.
 *
 * Supports provider/model notation `<provider>/<model>` (e.g.
 * `ollama/<model>`, `openai/<model>`, `anthropic/<model>`) and explicit
 * --provider / --base-url flags. Falls back to Anthropic when no provider is
 * specified.
 */

import type { KotaConfig } from "#core/config/config.js";
import type { ModelClient, ProviderFactoryOptions, ResolvedProvider } from "#core/model/model-client.js";
import { AnthropicModelClient } from "./anthropic.js";
import { FailoverModelClient } from "./failover-client.js";
import { OpenAIModelClient } from "./openai/client.js";
import {
	anthropicThinkingTranslator,
	type EffortTranslator,
	openaiReasoningEffortTranslator,
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
	lmstudio: { baseUrl: "http://localhost:1234/v1", apiKeyEnv: "" },
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

/** Resolve the API key for a given provider from explicit value or env var. */
export function resolveApiKey(
	providerName: string,
	explicit?: string,
): string {
	if (explicit) return explicit;
	if (providerName === "anthropic")
		return process.env.ANTHROPIC_API_KEY || "";
	const preset = PROVIDER_PRESETS[providerName];
	if (preset?.apiKeyEnv) return process.env[preset.apiKeyEnv] || "";
	return process.env.OPENAI_API_KEY || "";
}

function createClientForProvider(
	providerName: string,
	baseUrl?: string,
	apiKey?: string,
): ModelClient {
	if (providerName === "anthropic") {
		const resolvedKey = resolveApiKey(providerName, apiKey);
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

	const resolvedKey = resolveApiKey(providerName, apiKey);
	return new OpenAIModelClient({
		baseUrl: resolvedBaseUrl,
		apiKey: resolvedKey,
		presetName: providerName,
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
 * 3. Default: "anthropic"
 */
export function createModelClientImpl(
	opts: ProviderFactoryOptions,
): ResolvedProvider {
	const parsed = parseModelString(opts.model);
	const providerName = opts.provider || parsed.provider || "anthropic";
	const model = parsed.model;

	const primary = createClientForProvider(providerName, opts.baseUrl, opts.apiKey);

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
	const providerName = opts.provider || parsed.provider || "anthropic";
	const model = parsed.model;

	const primary = createClientForProvider(providerName, opts.baseUrl, opts.apiKey);
	const fallback = createClientForProvider(
		failoverConfig.provider,
		failoverConfig.baseUrl,
		failoverConfig.apiKey,
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
