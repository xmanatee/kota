export const OPENROUTER_MODEL_CATALOG_SOURCE_URL =
	"https://openrouter.ai/api/v1/models";
export const OPENROUTER_MODEL_CATALOG_OBSERVED_AT =
	"2026-06-26T06:45:00.000Z";
export const OPENROUTER_MODEL_CATALOG_MAX_STALENESS_DAYS = 90;

export type OpenRouterModality = "audio" | "file" | "image" | "text" | "video";

export type OpenRouterReasoningEffort =
	| "none"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";

export type OpenRouterSupportedParameter =
	| "frequency_penalty"
	| "include_reasoning"
	| "logit_bias"
	| "logprobs"
	| "max_completion_tokens"
	| "max_tokens"
	| "min_p"
	| "parallel_tool_calls"
	| "presence_penalty"
	| "reasoning"
	| "reasoning_effort"
	| "repetition_penalty"
	| "response_format"
	| "seed"
	| "stop"
	| "structured_outputs"
	| "temperature"
	| "tool_choice"
	| "tools"
	| "top_k"
	| "top_logprobs"
	| "top_p";

export type OpenRouterPricing = {
	readonly prompt: string;
	readonly completion: string;
	readonly inputCacheRead?: string;
	readonly inputCacheWrite?: string;
};

export type OpenRouterReasoningMetadata = {
	readonly mandatory: boolean;
	readonly defaultEnabled?: boolean;
	readonly supportedEfforts: readonly OpenRouterReasoningEffort[];
	readonly defaultEffort?: OpenRouterReasoningEffort;
};

export type OpenRouterObservedModel = {
	readonly id: string;
	readonly name: string;
	readonly canonicalSlug: string;
	readonly observedAt: string;
	readonly sourceUrl: string;
	readonly contextLength: number;
	readonly topProviderContextLength: number | null;
	readonly maxOutputTokens: number | null;
	readonly pricing: OpenRouterPricing;
	readonly inputModalities: readonly OpenRouterModality[];
	readonly outputModalities: readonly OpenRouterModality[];
	readonly supportedParameters: readonly OpenRouterSupportedParameter[];
	readonly reasoning: OpenRouterReasoningMetadata;
};

export type OpenRouterModelCapabilities = OpenRouterObservedModel & {
	readonly providerModelId: string;
	readonly supportsTools: boolean;
	readonly supportsToolChoice: boolean;
	readonly supportsParallelToolCalls: boolean;
	readonly supportsStructuredOutputs: boolean;
	readonly supportsReasoning: boolean;
	readonly reasoningEffortLevels: readonly OpenRouterReasoningEffort[];
	readonly mandatoryReasoning: boolean;
};

export type OpenRouterCandidateSetId = "openrouter-lab";

export const OPENROUTER_LAB_CANDIDATE_MODEL_IDS = [
	"z-ai/glm-5.2",
	"moonshotai/kimi-k2.7-code",
	"deepseek/deepseek-v4-pro",
	"deepseek/deepseek-v4-flash",
	"qwen/qwen3.7-plus",
	"qwen/qwen3.7-max",
	"minimax/minimax-m3",
	"xiaomi/mimo-v2.5",
	"xiaomi/mimo-v2.5-pro",
	"cohere/north-mini-code:free",
	"nvidia/nemotron-3-ultra-550b-a55b",
	"stepfun/step-3.7-flash",
	"inclusionai/ring-2.6-1t",
	"kwaipilot/kat-coder-pro-v2",
	"poolside/laguna-m.1",
	"tencent/hy3-preview",
] as const;

export const OPENROUTER_REQUESTED_CANDIDATE_RESOLUTIONS = [] as const;

export const OPENROUTER_DIRECT_PROVIDER_ROUTE_DECISIONS = [
	{
		provider: "z-ai",
		openRouterModelId: "z-ai/glm-5.2",
		decision: "openrouter-candidate",
		rationale:
			"KOTA does not ship a Z.ai provider preset with a base URL and auth contract; operators can still use an explicit OpenAI-compatible --provider/--base-url route.",
	},
	{
		provider: "moonshotai",
		openRouterModelId: "moonshotai/kimi-k2.7-code",
		decision: "openrouter-candidate",
		rationale:
			"KOTA does not ship a Kimi provider preset with a base URL and auth contract; operators can still use an explicit OpenAI-compatible --provider/--base-url route.",
	},
] as const;

const COMMON_TEXT_REASONING_TOOL_PARAMETERS = [
	"frequency_penalty",
	"include_reasoning",
	"logit_bias",
	"logprobs",
	"max_tokens",
	"min_p",
	"presence_penalty",
	"reasoning",
	"repetition_penalty",
	"response_format",
	"seed",
	"stop",
	"structured_outputs",
	"temperature",
	"tool_choice",
	"tools",
	"top_k",
	"top_logprobs",
	"top_p",
] as const satisfies readonly OpenRouterSupportedParameter[];

export const OPENROUTER_MODEL_CATALOG = [
	{
		id: "z-ai/glm-5.2",
		name: "Z.ai: GLM 5.2",
		canonicalSlug: "z-ai/glm-5.2-20260616",
		contextLength: 1_048_576,
		topProviderContextLength: 1_048_576,
		maxOutputTokens: 32_768,
		pricing: {
			prompt: "0.00000095",
			completion: "0.000003",
			inputCacheRead: "0.00000018",
		},
		inputModalities: ["text"],
		outputModalities: ["text"],
		supportedParameters: COMMON_TEXT_REASONING_TOOL_PARAMETERS,
		reasoning: {
			mandatory: false,
			defaultEnabled: true,
			supportedEfforts: ["xhigh", "high"],
			defaultEffort: "high",
		},
	},
	{
		id: "moonshotai/kimi-k2.7-code",
		name: "MoonshotAI: Kimi K2.7 Code",
		canonicalSlug: "moonshotai/kimi-k2.7-code-20260612",
		contextLength: 262_144,
		topProviderContextLength: 262_144,
		maxOutputTokens: 16_384,
		pricing: {
			prompt: "0.00000074",
			completion: "0.0000035",
			inputCacheRead: "0.00000015",
		},
		inputModalities: ["text", "image"],
		outputModalities: ["text"],
		supportedParameters: [
			"frequency_penalty",
			"include_reasoning",
			"logit_bias",
			"logprobs",
			"max_tokens",
			"min_p",
			"parallel_tool_calls",
			"presence_penalty",
			"reasoning",
			"reasoning_effort",
			"repetition_penalty",
			"response_format",
			"seed",
			"stop",
			"structured_outputs",
			"temperature",
			"tool_choice",
			"tools",
			"top_k",
			"top_logprobs",
			"top_p",
		],
		reasoning: {
			mandatory: true,
			defaultEnabled: true,
			supportedEfforts: [],
		},
	},
	{
		id: "deepseek/deepseek-v4-pro",
		name: "DeepSeek: DeepSeek V4 Pro",
		canonicalSlug: "deepseek/deepseek-v4-pro-20260423",
		contextLength: 1_048_576,
		topProviderContextLength: 1_048_576,
		maxOutputTokens: 384_000,
		pricing: {
			prompt: "0.000000435",
			completion: "0.00000087",
			inputCacheRead: "0.000000003625",
		},
		inputModalities: ["text"],
		outputModalities: ["text"],
		supportedParameters: COMMON_TEXT_REASONING_TOOL_PARAMETERS,
		reasoning: {
			mandatory: false,
			supportedEfforts: ["xhigh", "high"],
			defaultEffort: "high",
		},
	},
	{
		id: "deepseek/deepseek-v4-flash",
		name: "DeepSeek: DeepSeek V4 Flash",
		canonicalSlug: "deepseek/deepseek-v4-flash-20260423",
		contextLength: 1_048_576,
		topProviderContextLength: 1_000_000,
		maxOutputTokens: 65_536,
		pricing: {
			prompt: "0.00000009",
			completion: "0.00000018",
			inputCacheRead: "0.00000002",
		},
		inputModalities: ["text"],
		outputModalities: ["text"],
		supportedParameters: COMMON_TEXT_REASONING_TOOL_PARAMETERS,
		reasoning: {
			mandatory: false,
			supportedEfforts: ["xhigh", "high"],
			defaultEffort: "high",
		},
	},
	{
		id: "qwen/qwen3.7-plus",
		name: "Qwen: Qwen3.7 Plus",
		canonicalSlug: "qwen/qwen3.7-plus-20260602",
		contextLength: 1_000_000,
		topProviderContextLength: 1_000_000,
		maxOutputTokens: 65_536,
		pricing: {
			prompt: "0.00000032",
			completion: "0.00000128",
			inputCacheRead: "0.000000064",
			inputCacheWrite: "0.0000004",
		},
		inputModalities: ["text", "image"],
		outputModalities: ["text"],
		supportedParameters: [
			"include_reasoning",
			"logprobs",
			"max_tokens",
			"presence_penalty",
			"reasoning",
			"response_format",
			"seed",
			"structured_outputs",
			"temperature",
			"tool_choice",
			"tools",
			"top_logprobs",
			"top_p",
		],
		reasoning: {
			mandatory: false,
			defaultEnabled: true,
			supportedEfforts: [],
		},
	},
	{
		id: "qwen/qwen3.7-max",
		name: "Qwen: Qwen3.7 Max",
		canonicalSlug: "qwen/qwen3.7-max-20260520",
		contextLength: 1_000_000,
		topProviderContextLength: 1_000_000,
		maxOutputTokens: 65_536,
		pricing: {
			prompt: "0.00000125",
			completion: "0.00000375",
			inputCacheRead: "0.00000025",
			inputCacheWrite: "0.0000015625",
		},
		inputModalities: ["text"],
		outputModalities: ["text"],
		supportedParameters: [
			"include_reasoning",
			"logprobs",
			"max_tokens",
			"presence_penalty",
			"reasoning",
			"response_format",
			"seed",
			"structured_outputs",
			"temperature",
			"tool_choice",
			"tools",
			"top_logprobs",
			"top_p",
		],
		reasoning: {
			mandatory: false,
			defaultEnabled: true,
			supportedEfforts: [],
		},
	},
	{
		id: "minimax/minimax-m3",
		name: "MiniMax: MiniMax M3",
		canonicalSlug: "minimax/minimax-m3-20260531",
		contextLength: 1_048_576,
		topProviderContextLength: 524_288,
		maxOutputTokens: 512_000,
		pricing: {
			prompt: "0.0000003",
			completion: "0.0000012",
			inputCacheRead: "0.00000006",
		},
		inputModalities: ["text", "image", "video"],
		outputModalities: ["text"],
		supportedParameters: COMMON_TEXT_REASONING_TOOL_PARAMETERS,
		reasoning: {
			mandatory: false,
			supportedEfforts: [],
		},
	},
	{
		id: "xiaomi/mimo-v2.5",
		name: "Xiaomi: MiMo-V2.5",
		canonicalSlug: "xiaomi/mimo-v2.5-20260422",
		contextLength: 1_048_576,
		topProviderContextLength: 32_000,
		maxOutputTokens: null,
		pricing: {
			prompt: "0.000000105",
			completion: "0.00000028",
		},
		inputModalities: ["text", "audio", "image", "video"],
		outputModalities: ["text"],
		supportedParameters: [
			"frequency_penalty",
			"include_reasoning",
			"logit_bias",
			"logprobs",
			"max_tokens",
			"presence_penalty",
			"reasoning",
			"repetition_penalty",
			"response_format",
			"seed",
			"stop",
			"structured_outputs",
			"temperature",
			"tool_choice",
			"tools",
			"top_k",
			"top_logprobs",
			"top_p",
		],
		reasoning: {
			mandatory: false,
			supportedEfforts: [],
		},
	},
	{
		id: "xiaomi/mimo-v2.5-pro",
		name: "Xiaomi: MiMo-V2.5-Pro",
		canonicalSlug: "xiaomi/mimo-v2.5-pro-20260422",
		contextLength: 1_048_576,
		topProviderContextLength: 1_048_576,
		maxOutputTokens: 131_072,
		pricing: {
			prompt: "0.000000435",
			completion: "0.00000087",
			inputCacheRead: "0.0000000036",
		},
		inputModalities: ["text"],
		outputModalities: ["text"],
		supportedParameters: COMMON_TEXT_REASONING_TOOL_PARAMETERS,
		reasoning: {
			mandatory: false,
			supportedEfforts: [],
		},
	},
	{
		id: "cohere/north-mini-code:free",
		name: "Cohere: North Mini Code (free)",
		canonicalSlug: "cohere/north-mini-code-20260617",
		contextLength: 256_000,
		topProviderContextLength: 256_000,
		maxOutputTokens: 64_000,
		pricing: {
			prompt: "0",
			completion: "0",
		},
		inputModalities: ["text"],
		outputModalities: ["text"],
		supportedParameters: [
			"frequency_penalty",
			"include_reasoning",
			"max_tokens",
			"presence_penalty",
			"reasoning",
			"seed",
			"stop",
			"temperature",
			"tool_choice",
			"tools",
			"top_k",
			"top_p",
		],
		reasoning: {
			mandatory: false,
			supportedEfforts: [],
		},
	},
	{
		id: "nvidia/nemotron-3-ultra-550b-a55b",
		name: "NVIDIA: Nemotron 3 Ultra",
		canonicalSlug: "nvidia/nemotron-3-ultra-550b-a55b-20260604",
		contextLength: 1_000_000,
		topProviderContextLength: 262_144,
		maxOutputTokens: 16_384,
		pricing: {
			prompt: "0.0000005",
			completion: "0.0000022",
			inputCacheRead: "0.0000001",
		},
		inputModalities: ["text"],
		outputModalities: ["text"],
		supportedParameters: [
			"frequency_penalty",
			"include_reasoning",
			"logit_bias",
			"max_tokens",
			"min_p",
			"presence_penalty",
			"reasoning",
			"repetition_penalty",
			"response_format",
			"seed",
			"stop",
			"structured_outputs",
			"temperature",
			"tool_choice",
			"tools",
			"top_k",
			"top_p",
		],
		reasoning: {
			mandatory: false,
			defaultEnabled: true,
			supportedEfforts: ["high", "medium"],
			defaultEffort: "high",
		},
	},
	{
		id: "stepfun/step-3.7-flash",
		name: "StepFun: Step 3.7 Flash",
		canonicalSlug: "stepfun/step-3.7-flash-20260528",
		contextLength: 256_000,
		topProviderContextLength: 256_000,
		maxOutputTokens: 256_000,
		pricing: {
			prompt: "0.0000002",
			completion: "0.00000115",
			inputCacheRead: "0.00000004",
		},
		inputModalities: ["text", "image", "video"],
		outputModalities: ["text"],
		supportedParameters: COMMON_TEXT_REASONING_TOOL_PARAMETERS,
		reasoning: {
			mandatory: true,
			supportedEfforts: ["high", "medium", "low"],
			defaultEffort: "medium",
		},
	},
	{
		id: "inclusionai/ring-2.6-1t",
		name: "inclusionAI: Ring-2.6-1T",
		canonicalSlug: "inclusionai/ring-2.6-1t-20260423",
		contextLength: 262_144,
		topProviderContextLength: 262_144,
		maxOutputTokens: 32_768,
		pricing: {
			prompt: "0.000000075",
			completion: "0.000000625",
			inputCacheRead: "0.000000015",
		},
		inputModalities: ["text"],
		outputModalities: ["text"],
		supportedParameters: [
			"frequency_penalty",
			"include_reasoning",
			"logprobs",
			"max_tokens",
			"presence_penalty",
			"reasoning",
			"repetition_penalty",
			"response_format",
			"seed",
			"stop",
			"structured_outputs",
			"temperature",
			"tool_choice",
			"tools",
			"top_k",
			"top_logprobs",
			"top_p",
		],
		reasoning: {
			mandatory: false,
			defaultEnabled: true,
			supportedEfforts: [],
		},
	},
	{
		id: "kwaipilot/kat-coder-pro-v2",
		name: "Kwaipilot: KAT-Coder-Pro V2",
		canonicalSlug: "kwaipilot/kat-coder-pro-v2-20260327",
		contextLength: 256_000,
		topProviderContextLength: 256_000,
		maxOutputTokens: 80_000,
		pricing: {
			prompt: "0.0000003",
			completion: "0.0000012",
			inputCacheRead: "0.00000006",
		},
		inputModalities: ["text"],
		outputModalities: ["text"],
		supportedParameters: [
			"frequency_penalty",
			"logit_bias",
			"logprobs",
			"max_tokens",
			"min_p",
			"presence_penalty",
			"repetition_penalty",
			"response_format",
			"seed",
			"stop",
			"structured_outputs",
			"temperature",
			"tool_choice",
			"tools",
			"top_k",
			"top_logprobs",
			"top_p",
		],
		reasoning: {
			mandatory: false,
			supportedEfforts: [],
		},
	},
	{
		id: "poolside/laguna-m.1",
		name: "Poolside: Laguna M.1",
		canonicalSlug: "poolside/laguna-m.1-20260312",
		contextLength: 262_144,
		topProviderContextLength: 262_144,
		maxOutputTokens: 32_768,
		pricing: {
			prompt: "0.0000002",
			completion: "0.0000004",
			inputCacheRead: "0.0000001",
		},
		inputModalities: ["text"],
		outputModalities: ["text"],
		supportedParameters: [
			"include_reasoning",
			"max_tokens",
			"reasoning",
			"temperature",
			"tool_choice",
			"tools",
		],
		reasoning: {
			mandatory: false,
			defaultEnabled: true,
			supportedEfforts: [],
		},
	},
	{
		id: "tencent/hy3-preview",
		name: "Tencent: Hy3 preview",
		canonicalSlug: "tencent/hy3-preview-20260421",
		contextLength: 262_144,
		topProviderContextLength: 262_144,
		maxOutputTokens: null,
		pricing: {
			prompt: "0.000000063",
			completion: "0.00000021",
			inputCacheRead: "0.000000021",
		},
		inputModalities: ["text"],
		outputModalities: ["text"],
		supportedParameters: [
			"frequency_penalty",
			"include_reasoning",
			"max_tokens",
			"presence_penalty",
			"reasoning",
			"seed",
			"stop",
			"temperature",
			"tool_choice",
			"tools",
			"top_k",
			"top_p",
		],
		reasoning: {
			mandatory: false,
			defaultEnabled: true,
			supportedEfforts: ["high", "low", "none"],
			defaultEffort: "high",
		},
	},
] as const satisfies readonly Omit<
	OpenRouterObservedModel,
	"observedAt" | "sourceUrl"
>[];
