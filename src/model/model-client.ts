/**
 * Abstract LLM client interface and model client registry.
 *
 * The interface and registry live in core. Implementations (Anthropic, OpenAI,
 * etc.) live in the model-clients module and register via
 * `registerModelClientFactory` at module load time.
 */

import type Anthropic from "@anthropic-ai/sdk";

/** Minimal stream interface matching the Anthropic SDK's MessageStream subset KOTA uses. */
export interface MessageStream {
	on(event: "text", cb: (delta: string) => void): this;
	on(event: "thinking", cb: (delta: string) => void): this;
	finalMessage(): Promise<Anthropic.Message>;
}

/** Parameters for streaming message creation. */
export type MessageStreamParams = {
	model: string;
	max_tokens: number;
	system?: Anthropic.Messages.TextBlockParam[] | string;
	messages: Anthropic.MessageParam[];
	tools?: Anthropic.Tool[];
	thinking?: Anthropic.Messages.ThinkingConfigParam;
};

/** Parameters for non-streaming message creation. */
export type MessageCreateParams = {
	model: string;
	max_tokens: number;
	system?: string;
	messages: Anthropic.MessageParam[];
};

/** Abstract LLM client — swap providers without changing agent code. */
export interface ModelClient {
	messages: {
		stream(params: MessageStreamParams): MessageStream;
		create(params: MessageCreateParams): Promise<Anthropic.Message>;
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
