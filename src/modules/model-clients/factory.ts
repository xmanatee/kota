/**
 * Provider factory — resolves a ModelClient from CLI flags, config, and env vars.
 *
 * Supports provider/model notation (e.g., "ollama/llama3", "openai/gpt-4o")
 * and explicit --provider / --base-url flags. Falls back to Anthropic when
 * no provider is specified.
 */

import type { ProviderFactoryOptions, ResolvedProvider } from "#core/model/model-client.js";
import { AnthropicModelClient } from "./anthropic.js";
import { OpenAIModelClient } from "./openai/client.js";

/** Known provider presets: base URL and env var for the API key. */
export const PROVIDER_PRESETS: Record<
	string,
	{ baseUrl: string; apiKeyEnv: string }
> = {
	openai: {
		baseUrl: "https://api.openai.com/v1",
		apiKeyEnv: "OPENAI_API_KEY",
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

	if (providerName === "anthropic") {
		return {
			client: new AnthropicModelClient({ maxRetries: 5 }),
			model,
			providerName,
		};
	}

	// OpenAI-compatible provider
	const preset = PROVIDER_PRESETS[providerName];
	const baseUrl = opts.baseUrl || preset?.baseUrl;
	if (!baseUrl) {
		throw new Error(
			`Unknown provider "${providerName}" and no --base-url specified.\n\n` +
				`Known providers: anthropic, ${Object.keys(PROVIDER_PRESETS).join(", ")}\n` +
				"Or pass --base-url for any OpenAI-compatible endpoint.",
		);
	}

	const apiKey = resolveApiKey(providerName, opts.apiKey);

	return {
		client: new OpenAIModelClient({ baseUrl, apiKey }),
		model,
		providerName,
	};
}
