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

/** ModelClient wrapping the Anthropic SDK. */
export class AnthropicModelClient implements ModelClient {
	readonly messages: ModelClient["messages"];

	constructor(options?: { maxRetries?: number }) {
		const sdk = new Anthropic(options);
		this.messages = {
			stream: (params: MessageStreamParams) =>
				sdk.messages.stream(
					params as Parameters<typeof sdk.messages.stream>[0],
				) as unknown as MessageStream,
			create: (params: MessageCreateParams) =>
				sdk.messages.create(
					params as Parameters<typeof sdk.messages.create>[0],
				) as unknown as Promise<Anthropic.Message>,
		};
	}
}
