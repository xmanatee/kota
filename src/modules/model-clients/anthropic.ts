/**
 * Anthropic SDK-backed ModelClient implementation.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
	KotaContentBlock,
	KotaImageBlock,
	KotaMessage,
	KotaMessageStream,
	KotaModelResponse,
	KotaModelUsage,
	KotaStopReason,
	KotaTextBlock,
	KotaThinkingBlock,
	KotaThinkingConfig,
	KotaTool,
	KotaToolResultBlock,
	KotaToolResultBlockContent,
	KotaToolUseBlock,
} from "#core/agent-harness/message-protocol.js";
import type {
	MessageCreateParams,
	MessageStreamParams,
	ModelClient,
} from "#core/model/model-client.js";
import { anthropicThinkingTranslator } from "./reasoning.js";

/**
 * Translate a neutral `KotaTextBlock` to Anthropic's `TextBlockParam` shape.
 * The shapes overlap structurally, so this is a field-for-field copy — but
 * the explicit call site is the invariant, not a pass-through cast.
 */
export function kotaTextBlockToAnthropic(
	block: KotaTextBlock,
): Anthropic.Messages.TextBlockParam {
	return {
		type: "text",
		text: block.text,
		...(block.cache_control ? { cache_control: block.cache_control } : {}),
	};
}

/**
 * Narrow `media_type` string to the Anthropic-supported literal union. Unknown
 * values fall back to `image/png`; the loop today only produces images through
 * tool outputs, which already speak a supported subset.
 */
function narrowImageMediaType(
	mediaType: string,
): Anthropic.Base64ImageSource["media_type"] {
	if (
		mediaType === "image/jpeg" ||
		mediaType === "image/png" ||
		mediaType === "image/gif" ||
		mediaType === "image/webp"
	) {
		return mediaType;
	}
	return "image/png";
}

function kotaImageBlockToAnthropic(
	block: KotaImageBlock,
): Anthropic.Messages.ImageBlockParam {
	return {
		type: "image",
		source: {
			type: "base64",
			media_type: narrowImageMediaType(block.source.media_type),
			data: block.source.data,
		},
	};
}

function kotaToolUseBlockToAnthropic(
	block: KotaToolUseBlock,
): Anthropic.Messages.ToolUseBlockParam {
	return {
		type: "tool_use",
		id: block.id,
		name: block.name,
		input: block.input,
	};
}

function kotaToolResultContentToAnthropic(
	content: KotaToolResultBlockContent,
): Anthropic.Messages.ToolResultBlockParam["content"] {
	if (typeof content === "string") return content;
	return content.map((b) => {
		if (b.type === "text") return kotaTextBlockToAnthropic(b);
		return kotaImageBlockToAnthropic(b);
	});
}

function kotaToolResultBlockToAnthropic(
	block: KotaToolResultBlock,
): Anthropic.Messages.ToolResultBlockParam {
	return {
		type: "tool_result",
		tool_use_id: block.tool_use_id,
		content: kotaToolResultContentToAnthropic(block.content),
		...(block.is_error !== undefined ? { is_error: block.is_error } : {}),
	};
}

function kotaThinkingBlockToAnthropic(
	block: KotaThinkingBlock,
): Anthropic.Messages.ThinkingBlockParam {
	return {
		type: "thinking",
		thinking: block.thinking,
		signature: block.signature,
	};
}

/**
 * Translate a neutral `KotaContentBlock` to the matching Anthropic content
 * block-param variant. Every block variant maps field-for-field at this seam;
 * new variants added to `KotaContentBlock` must be handled exhaustively here.
 */
export function kotaBlockToAnthropicBlock(
	block: KotaContentBlock,
): Anthropic.Messages.ContentBlockParam {
	switch (block.type) {
		case "text":
			return kotaTextBlockToAnthropic(block);
		case "image":
			return kotaImageBlockToAnthropic(block);
		case "tool_use":
			return kotaToolUseBlockToAnthropic(block);
		case "tool_result":
			return kotaToolResultBlockToAnthropic(block);
		case "thinking":
			return kotaThinkingBlockToAnthropic(block);
	}
}

/**
 * Translate a neutral `KotaMessage` to Anthropic's `MessageParam`. Messages
 * with string content pass through; messages with a block list are translated
 * variant-by-variant via `kotaBlockToAnthropicBlock`.
 */
export function kotaMessageToAnthropicMessage(
	msg: KotaMessage,
): Anthropic.MessageParam {
	if (typeof msg.content === "string") {
		return { role: msg.role, content: msg.content };
	}
	return {
		role: msg.role,
		content: msg.content.map(kotaBlockToAnthropicBlock),
	};
}

/**
 * Translate a neutral `KotaTool` to the Anthropic SDK's `Tool` shape. Today
 * the two shapes overlap structurally, so this is a no-op conversion — but
 * the explicit call site is the invariant: every place that hands tools to
 * the Anthropic SDK goes through this helper, not a pass-through cast.
 */
export function kotaToAnthropicTool(tool: KotaTool): Anthropic.Tool {
	return {
		name: tool.name,
		description: tool.description,
		input_schema: tool.input_schema,
	};
}

/**
 * Translate a neutral `KotaThinkingConfig` to Anthropic's `ThinkingConfigParam`
 * shape with an explicit field-for-field mapping. The two shapes overlap
 * structurally, but this helper is the seam: every place that hands a
 * thinking config to the Anthropic SDK goes through it, not a pass-through
 * cast. The discriminated union collapses to the matching SDK variant.
 */
export function kotaToAnthropicThinkingConfig(
	config: KotaThinkingConfig,
): Anthropic.Messages.ThinkingConfigParam {
	if (config.type === "enabled") {
		return { type: "enabled", budget_tokens: config.budget_tokens };
	}
	return { type: "disabled" };
}

/**
 * Anthropic SDK content blocks carry extra fields (`citations`, thinking
 * signatures, server-tool-use) that are not part of the neutral
 * `KotaContentBlock` union. This helper narrows block-by-block and drops
 * anything the core protocol does not express; new variants must be added
 * here deliberately.
 */
function anthropicBlockToKotaBlock(
	block: Anthropic.Messages.ContentBlock,
): KotaContentBlock | null {
	switch (block.type) {
		case "text":
			return { type: "text", text: block.text };
		case "tool_use":
			return {
				type: "tool_use",
				id: block.id,
				name: block.name,
				input: block.input,
			};
		case "thinking":
			return {
				type: "thinking",
				thinking: block.thinking,
				signature: block.signature,
			};
		default:
			return null;
	}
}

/**
 * Narrow an Anthropic stop_reason string to the neutral `KotaStopReason`
 * union. The SDK types stop_reason as `string | null` for forward
 * compatibility with new model variants; this helper maps known values and
 * falls back to `"end_turn"` for unexpected values — the loop treats an
 * unknown reason as a normal end-of-turn rather than failing the whole run.
 */
function narrowAnthropicStopReason(
	reason: string | null | undefined,
): KotaStopReason | null {
	if (reason === null || reason === undefined) return null;
	switch (reason) {
		case "end_turn":
		case "max_tokens":
		case "stop_sequence":
		case "tool_use":
		case "pause_turn":
		case "refusal":
			return reason;
		default:
			return "end_turn";
	}
}

function anthropicUsageToKotaUsage(
	usage: Anthropic.Messages.Usage,
): KotaModelUsage {
	return {
		input_tokens: usage.input_tokens,
		output_tokens: usage.output_tokens,
		cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
		cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null,
	};
}

/**
 * Translate an Anthropic SDK `Message` to the neutral `KotaModelResponse`
 * field-for-field. This is the single seam where the SDK's wider shape
 * narrows to core's contract — no `as` cast past this helper.
 */
export function anthropicMessageToKotaResponse(
	message: Anthropic.Message,
): KotaModelResponse {
	const content: KotaContentBlock[] = [];
	for (const block of message.content) {
		const translated = anthropicBlockToKotaBlock(block);
		if (translated) content.push(translated);
	}
	return {
		id: message.id,
		role: "assistant",
		model: message.model,
		content,
		stop_reason: narrowAnthropicStopReason(message.stop_reason),
		stop_sequence: message.stop_sequence ?? null,
		usage: anthropicUsageToKotaUsage(message.usage),
	};
}

/**
 * Minimal shape of the Anthropic SDK's `MessageStream` surface that KOTA
 * consumes. Typed structurally so the wrapper does not have to name the SDK's
 * internal `MessageStream` class path.
 */
type AnthropicMessageStreamLike = {
	on(event: "text", cb: (delta: string) => void): unknown;
	on(event: "thinking", cb: (delta: string) => void): unknown;
	finalMessage(): Promise<Anthropic.Message>;
};

/**
 * Wrap an Anthropic SDK `MessageStream` as a neutral `KotaMessageStream`.
 * The SDK stream is kept for its event loop (text/thinking deltas) and only
 * the final message is translated to the neutral shape; the wrapper exposes
 * only the events core reads.
 */
export function wrapAnthropicStream(
	stream: AnthropicMessageStreamLike,
): KotaMessageStream {
	const wrapper: KotaMessageStream = {
		on(event, cb) {
			if (event === "text") stream.on("text", cb);
			else stream.on("thinking", cb);
			return wrapper;
		},
		async finalMessage() {
			const message = await stream.finalMessage();
			return anthropicMessageToKotaResponse(message);
		},
	};
	return wrapper;
}

/** ModelClient wrapping the Anthropic SDK. */
export class AnthropicModelClient implements ModelClient {
	readonly messages: ModelClient["messages"];

	constructor(options?: { maxRetries?: number; apiKey?: string }) {
		const sdk = new Anthropic(options);
		this.messages = {
			stream: (params: MessageStreamParams) => {
				const sdkStream = sdk.messages.stream(
					toAnthropicStreamParams(params) as Parameters<typeof sdk.messages.stream>[0],
				) as unknown as AnthropicMessageStreamLike;
				return wrapAnthropicStream(sdkStream);
			},
			create: async (params: MessageCreateParams) => {
				const sdkMessage = (await sdk.messages.create(
					toAnthropicCreateParams(params) as Parameters<typeof sdk.messages.create>[0],
				)) as Anthropic.Message;
				return anthropicMessageToKotaResponse(sdkMessage);
			},
		};
	}
}

type AnthropicStreamParamsOnWire = Omit<
	MessageStreamParams,
	"tools" | "thinking" | "system" | "messages"
> & {
	tools?: Anthropic.Tool[];
	thinking?: Anthropic.Messages.ThinkingConfigParam;
	system?: Anthropic.Messages.TextBlockParam[] | string;
	messages: Anthropic.MessageParam[];
};

function toAnthropicStreamParams(
	params: MessageStreamParams,
): AnthropicStreamParamsOnWire {
	const withEffort = applyAnthropicEffort(params);
	const { tools, thinking, system, messages, ...rest } = withEffort;
	return {
		...rest,
		messages: messages.map(kotaMessageToAnthropicMessage),
		...(system !== undefined
			? {
					system:
						typeof system === "string"
							? system
							: system.map(kotaTextBlockToAnthropic),
				}
			: {}),
		...(tools ? { tools: tools.map(kotaToAnthropicTool) } : {}),
		...(thinking ? { thinking: kotaToAnthropicThinkingConfig(thinking) } : {}),
	};
}

function toAnthropicCreateParams(
	params: MessageCreateParams,
): Omit<MessageCreateParams, "messages"> & {
	messages: Anthropic.MessageParam[];
} {
	return {
		...params,
		messages: params.messages.map(kotaMessageToAnthropicMessage),
	};
}

/**
 * Translate `effort` to a `thinking` config for the Anthropic SDK. An explicit
 * `thinking` on the params wins — existing claude-agent-sdk-native callers are
 * allowed to keep the precise knob they passed.
 */
function applyAnthropicEffort(params: MessageStreamParams): MessageStreamParams {
	if (params.effort === undefined || params.thinking !== undefined) {
		const { effort: _effort, ...rest } = params;
		return rest;
	}
	const patch = anthropicThinkingTranslator.apply(params.effort);
	const { effort: _effort, ...rest } = params;
	return {
		...rest,
		thinking: patch.thinking as KotaThinkingConfig,
	};
}
