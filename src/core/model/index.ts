/**
 * Model subsystem — LLM client abstraction, adaptive model routing,
 * streaming, and mock client for testing.
 *
 * Implementations (Anthropic, OpenAI) live in src/modules/model-clients/.
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
	checkPresetAuth,
	getPreset,
	hasPreset,
	listShippedPresetIds,
	listShippedPresets,
	mergePresetTiers,
	PRESET_ENV_VAR,
	type Preset,
	type PresetAuthCheck,
	type PresetId,
	type PresetResolution,
	type PresetResolutionInput,
	type PresetSource,
	type PresetTiers,
	resolvePreset,
	resolvePresetTierModel,
	SHIPPED_DEFAULT_PRESET_ID,
} from "./preset.js";
export {
	isRetryable,
	type StreamConfig,
	streamMessage,
} from "./streaming.js";
