/**
 * Model subsystem — LLM client abstraction, adaptive model routing,
 * provider factory, streaming, and mock client for testing.
 */

export {
	createMockClient,
	type MockApiCall,
	multiToolResponse,
	resetMockIds,
	textResponse,
	toolUseResponse,
} from "./mock-client.js";
export {
	AnthropicModelClient,
	type MessageCreateParams,
	type MessageStream,
	type MessageStreamParams,
	type ModelClient,
} from "./model-client.js";
export {
	DEFAULT_MODEL_TIERS,
	type DelegateBackend,
	type ModelRouteResult,
	type ModelTier,
	type ModelTiers,
	resolveModelForTier,
	routeModel,
} from "./model-router.js";
export {
	createModelClient,
	PROVIDER_PRESETS,
	type ProviderFactoryOptions,
	parseModelString,
	type ResolvedProvider,
	resolveApiKey,
} from "./provider-factory.js";
export {
	isRetryable,
	type StreamConfig,
	streamMessage,
} from "./streaming.js";
