/**
 * Abstract LLM client interface, decoupling the agent from any specific SDK.
 * Enables provider swapping (Anthropic API, Claude Agent SDK, etc.).
 */

import Anthropic from "@anthropic-ai/sdk";

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

/** Default implementation wrapping the Anthropic SDK. */
export class AnthropicModelClient implements ModelClient {
	readonly messages: ModelClient["messages"];

	constructor(options?: { maxRetries?: number }) {
		const sdk = new Anthropic(options);
		this.messages = {
			stream: (params) =>
				sdk.messages.stream(
					params as Parameters<typeof sdk.messages.stream>[0],
				) as unknown as MessageStream,
			create: (params) =>
				sdk.messages.create(
					params as Parameters<typeof sdk.messages.create>[0],
				) as unknown as Promise<Anthropic.Message>,
		};
	}
}
