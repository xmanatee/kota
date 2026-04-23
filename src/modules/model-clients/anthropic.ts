/**
 * Anthropic SDK-backed ModelClient implementation.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
	MessageCreateParams,
	MessageStream,
	MessageStreamParams,
	ModelClient,
} from "#core/model/model-client.js";
import { anthropicThinkingTranslator } from "./reasoning.js";

/** ModelClient wrapping the Anthropic SDK. */
export class AnthropicModelClient implements ModelClient {
	readonly messages: ModelClient["messages"];

	constructor(options?: { maxRetries?: number; apiKey?: string }) {
		const sdk = new Anthropic(options);
		this.messages = {
			stream: (params: MessageStreamParams) =>
				sdk.messages.stream(
					applyAnthropicEffort(params) as Parameters<typeof sdk.messages.stream>[0],
				) as unknown as MessageStream,
			create: (params: MessageCreateParams) =>
				sdk.messages.create(
					params as Parameters<typeof sdk.messages.create>[0],
				) as unknown as Promise<Anthropic.Message>,
		};
	}
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
		thinking: patch.thinking as Anthropic.Messages.ThinkingConfigParam,
	};
}
