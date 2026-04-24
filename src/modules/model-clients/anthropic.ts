/**
 * Anthropic SDK-backed ModelClient implementation.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { KotaThinkingConfig, KotaTool } from "#core/agent-harness/message-protocol.js";
import type {
	MessageCreateParams,
	MessageStream,
	MessageStreamParams,
	ModelClient,
} from "#core/model/model-client.js";
import { anthropicThinkingTranslator } from "./reasoning.js";

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

/** ModelClient wrapping the Anthropic SDK. */
export class AnthropicModelClient implements ModelClient {
	readonly messages: ModelClient["messages"];

	constructor(options?: { maxRetries?: number; apiKey?: string }) {
		const sdk = new Anthropic(options);
		this.messages = {
			stream: (params: MessageStreamParams) =>
				sdk.messages.stream(
					toAnthropicStreamParams(params) as Parameters<typeof sdk.messages.stream>[0],
				) as unknown as MessageStream,
			create: (params: MessageCreateParams) =>
				sdk.messages.create(
					params as Parameters<typeof sdk.messages.create>[0],
				) as unknown as Promise<Anthropic.Message>,
		};
	}
}

function toAnthropicStreamParams(
	params: MessageStreamParams,
): Omit<MessageStreamParams, "tools" | "thinking"> & {
	tools?: Anthropic.Tool[];
	thinking?: Anthropic.Messages.ThinkingConfigParam;
} {
	const withEffort = applyAnthropicEffort(params);
	const { tools, thinking, ...rest } = withEffort;
	return {
		...rest,
		...(tools ? { tools: tools.map(kotaToAnthropicTool) } : {}),
		...(thinking ? { thinking: kotaToAnthropicThinkingConfig(thinking) } : {}),
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
