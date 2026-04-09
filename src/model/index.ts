/**
 * Model subsystem — LLM client abstraction, adaptive model routing,
 * streaming, and mock client for testing.
 *
 * Implementations (Anthropic, OpenAI) live in src/extensions/model-clients/.
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
	createModelClient,
	type MessageCreateParams,
	type MessageStream,
	type MessageStreamParams,
	type ModelClient,
	type ModelClientFactoryFn,
	type ProviderFactoryOptions,
	type ResolvedProvider,
	registerModelClientFactory,
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
	isRetryable,
	type StreamConfig,
	streamMessage,
} from "./streaming.js";
