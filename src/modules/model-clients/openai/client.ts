/**
 * OpenAI-compatible ModelClient implementation.
 *
 * Works with any OpenAI-compatible provider: OpenAI, Ollama, Groq,
 * Together, vLLM, LM Studio, etc.
 */

import type { KotaModelResponse } from "#core/agent-harness/message-protocol.js";
import type {
	MessageCreateParams,
	MessageStream,
	MessageStreamParams,
	ModelClient,
} from "#core/model/model-client.js";
import { buildMissingReasoningError, type EffortTranslator } from "../reasoning.js";
import { OpenAIStream } from "./stream.js";
import { buildKotaModelResponse, mapFinishReason, safeJsonParse, toOpenAIMessages, toOpenAITools } from "./translations.js";
import type { OAIResponse } from "./types.js";

export type OpenAIClientOptions = {
	baseUrl: string;
	apiKey: string;
	/**
	 * Operator-facing name of the preset this client was built for — used in
	 * error messages when the caller sets `effort` against a preset that has
	 * no reasoning mapping.
	 */
	presetName: string;
	/**
	 * Reasoning-effort translator for this preset, or `undefined` if the
	 * preset cannot express reasoning. When `undefined`, any non-undefined
	 * `effort` on a stream call throws loudly rather than silently producing
	 * a call at the provider's default reasoning budget.
	 */
	effortTranslator?: EffortTranslator;
};

/** ModelClient backed by any OpenAI-compatible API (OpenAI, Ollama, Groq, etc.). */
export class OpenAIModelClient implements ModelClient {
	readonly messages: ModelClient["messages"];
	private baseUrl: string;
	private apiKey: string;
	private presetName: string;
	private effortTranslator: EffortTranslator | undefined;

	constructor(options: OpenAIClientOptions) {
		this.baseUrl = options.baseUrl.replace(/\/+$/, "");
		this.apiKey = options.apiKey;
		this.presetName = options.presetName;
		this.effortTranslator = options.effortTranslator;

		this.messages = {
			stream: (params: MessageStreamParams) => this.doStream(params),
			create: (params: MessageCreateParams) => this.doCreate(params),
		};
	}

	private buildHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
		return headers;
	}

	private doStream(params: MessageStreamParams): MessageStream {
		const body = this.buildRequestBody(params, true);
		const url = `${this.baseUrl}/chat/completions`;
		const headers = this.buildHeaders();

		return new OpenAIStream(
			() => fetch(url, { method: "POST", headers, body: JSON.stringify(body) }),
			params.model,
		);
	}

	private async doCreate(
		params: MessageCreateParams,
	): Promise<KotaModelResponse> {
		const body = this.buildRequestBody(params, false);
		const url = `${this.baseUrl}/chat/completions`;

		const response = await fetch(url, {
			method: "POST",
			headers: this.buildHeaders(),
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`OpenAI API error ${response.status}: ${text}`);
		}

		const data = (await response.json()) as OAIResponse;
		const choice = data.choices[0];
		if (!choice) {
			throw new Error("OpenAI API returned no choices");
		}

		const textContent = choice.message.content ?? "";
		const toolCalls = (choice.message.tool_calls ?? []).map((tc) => ({
			id: tc.id,
			name: tc.function.name,
			input: safeJsonParse(tc.function.arguments),
		}));

		return buildKotaModelResponse({
			text: textContent,
			toolCalls,
			stopReason: mapFinishReason(choice.finish_reason),
			model: data.model || params.model,
			usage: {
				input: data.usage?.prompt_tokens ?? 0,
				output: data.usage?.completion_tokens ?? 0,
			},
		});
	}

	private buildRequestBody(
		params: MessageStreamParams | MessageCreateParams,
		stream: boolean,
	): Record<string, unknown> {
		const oaiMessages = toOpenAIMessages(params.system, params.messages);
		const body: Record<string, unknown> = {
			model: params.model,
			max_tokens: params.max_tokens,
			messages: oaiMessages,
			stream,
		};
		if ("tools" in params && params.tools?.length) {
			body.tools = toOpenAITools(params.tools);
		}
		if (stream) {
			body.stream_options = { include_usage: true };
		}
		if ("effort" in params && params.effort !== undefined) {
			if (!this.effortTranslator) {
				throw buildMissingReasoningError(this.presetName, params.effort);
			}
			Object.assign(body, this.effortTranslator.apply(params.effort));
		}
		return body;
	}
}
