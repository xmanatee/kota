/**
 * Abstract LLM client interface and model client registry.
 *
 * The interface and registry live in core. Implementations (Anthropic, OpenAI,
 * etc.) live in the model-clients module and register via
 * `registerModelClientFactory` at module load time.
 */

import type {
	KotaMessage,
	KotaMessageStream,
	KotaModelResponse,
	KotaTextBlock,
	KotaThinkingConfig,
	KotaTool,
} from "#core/agent-harness/message-protocol.js";
import type { AgentEffort } from "#core/agent-harness/types.js";

export type { AgentEffort };

/**
 * Public alias for the neutral stream shape. `MessageStream` is the name the
 * loop and sub-agent code have always used; its definition is now the neutral
 * `KotaMessageStream`, so callers see one consistent surface.
 */
export type MessageStream = KotaMessageStream;

/** Parameters for streaming message creation. */
export type MessageStreamParams = {
	model: string;
	max_tokens: number;
	system?: KotaTextBlock[] | string;
	messages: KotaMessage[];
	tools?: KotaTool[];
	thinking?: KotaThinkingConfig;
	/**
	 * Declared reasoning posture for this call. Providers that expose a
	 * reasoning control translate this verbatim at the wire boundary
	 * (e.g. OpenAI o-series → `reasoning.effort`, Anthropic → `thinking`).
	 * Providers without a declared mapping throw loudly when this is set
	 * rather than silently falling back to the default reasoning budget.
	 */
	effort?: AgentEffort;
	/**
	 * Optional abort signal. Adapters propagate this to the underlying
	 * request (Anthropic SDK request options, OpenAI-compatible `fetch`)
	 * so an outer abort cancels the in-flight model call rather than
	 * leaving the harness waiting for the model to return on its own.
	 * The field is a request-level option; providers must not include it
	 * in the wire body.
	 */
	signal?: AbortSignal;
};

/** Parameters for non-streaming message creation. */
export type MessageCreateParams = {
	model: string;
	max_tokens: number;
	system?: string;
	messages: KotaMessage[];
	/**
	 * Optional abort signal. See {@link MessageStreamParams.signal}.
	 */
	signal?: AbortSignal;
};

/** Abstract LLM client — swap providers without changing agent code. */
export interface ModelClient {
	messages: {
		stream(params: MessageStreamParams): KotaMessageStream;
		create(params: MessageCreateParams): Promise<KotaModelResponse>;
	};
}

/** Options for creating a model client. */
export type ProviderFactoryOptions = {
	/** Model string — may include provider prefix (e.g., "ollama/llama3"). */
	model: string;
	/** Explicit provider name, overrides prefix in model string. */
	provider?: string;
	/** Explicit base URL, overrides preset. */
	baseUrl?: string;
	/** Explicit API key, overrides env var resolution. */
	apiKey?: string;
};

/** Result of resolving a model client. */
export type ResolvedProvider = {
	client: ModelClient;
	model: string;
	providerName: string;
};

export type ModelClientFactoryFn = (opts: ProviderFactoryOptions) => ResolvedProvider;

let _factory: ModelClientFactoryFn | null = null;

/** Register the model client factory (called by the model-clients module at load time). */
export function registerModelClientFactory(fn: ModelClientFactoryFn): void {
	_factory = fn;
}

/**
 * Create a ModelClient from provider options.
 * Delegates to the factory registered by the model-clients module.
 */
export function createModelClient(opts: ProviderFactoryOptions): ResolvedProvider {
	if (!_factory) {
		throw new Error(
			"No model client factory registered. Ensure the model-clients module is loaded.",
		);
	}
	return _factory(opts);
}
