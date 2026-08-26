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
import {
	OUTBOUND_HTTP_PROFILES,
	type OutboundHttpStreamingPort,
	outboundHttp,
} from "#core/outbound-http/index.js";
import type { EffortTranslator } from "../reasoning.js";
import { formatOpenAIHttpError } from "./http-error.js";
import { buildOpenAIRequestBody } from "./request-body.js";
import { OpenAIStream } from "./stream.js";
import {
	buildKotaModelResponse,
	mapFinishReason,
	openAIUsageToKotaUsage,
	safeJsonParse,
} from "./translations.js";
import type {
	OAIModelCapabilities,
	OAIRequestOptions,
	OAIResponse,
} from "./types.js";

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
	/**
	 * Model-specific capability metadata resolved by the provider factory.
	 * Undefined means a custom/local OpenAI-compatible endpoint where KOTA
	 * cannot safely validate model-specific feature support.
	 */
	modelCapabilities?: OAIModelCapabilities;
	/** Adapter-private provider wire options; core callers keep using the neutral protocol. */
	requestOptions?: OAIRequestOptions;
	/** Shared outbound request boundary; supplied by tests or alternate hosts. */
	http?: OutboundHttpStreamingPort;
};

/** ModelClient backed by any OpenAI-compatible API (OpenAI, Ollama, Groq, etc.). */
export class OpenAIModelClient implements ModelClient {
	readonly messages: ModelClient["messages"];
	private baseUrl: string;
	private apiKey: string;
	private presetName: string;
	private effortTranslator: EffortTranslator | undefined;
	private modelCapabilities: OAIModelCapabilities | undefined;
	private requestOptions: OAIRequestOptions;
	private http: OutboundHttpStreamingPort;

	constructor(options: OpenAIClientOptions) {
		this.baseUrl = options.baseUrl.replace(/\/+$/, "");
		this.apiKey = options.apiKey;
		this.presetName = options.presetName;
		this.effortTranslator = options.effortTranslator;
		this.modelCapabilities = options.modelCapabilities;
		this.requestOptions = options.requestOptions ?? {};
		this.http = options.http ?? outboundHttp;

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
		const { signal } = params;

		return new OpenAIStream(
			async () => {
				const { response } = await this.http.requestStream({
					profile: OUTBOUND_HTTP_PROFILES.configuredProvider([this.baseUrl]),
					operation: "model.openai.chat-stream",
					url,
					method: "POST",
					headers,
					body: JSON.stringify(body),
					...(signal ? { signal } : {}),
				});
				return response;
			},
			params.model,
		);
	}

	private async doCreate(
		params: MessageCreateParams,
	): Promise<KotaModelResponse> {
		const body = this.buildRequestBody(params, false);
		const url = `${this.baseUrl}/chat/completions`;

		const { response } = await this.http.request({
			profile: OUTBOUND_HTTP_PROFILES.configuredProvider([this.baseUrl]),
			operation: "model.openai.chat-create",
			url,
			method: "POST",
			headers: this.buildHeaders(),
			body: JSON.stringify(body),
			...(params.signal ? { signal: params.signal } : {}),
		});

		if (!response.ok) {
			const text = await response.text();
			throw formatOpenAIHttpError(response.status, text);
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
			usage: openAIUsageToKotaUsage(data.usage),
		});
	}

	private buildRequestBody(
		params: MessageStreamParams | MessageCreateParams,
		stream: boolean,
	) {
		return buildOpenAIRequestBody(params, stream, {
			presetName: this.presetName,
			effortTranslator: this.effortTranslator,
			modelCapabilities: this.modelCapabilities,
			requestOptions: this.requestOptions,
		});
	}
}
