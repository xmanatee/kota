/**
 * OpenAI-compatible ModelClient — translates between KOTA's neutral message
 * protocol (used internally) and the OpenAI chat completions API wire format.
 */

export { type OpenAIClientOptions, OpenAIModelClient } from "./client.js";
export { OpenAIStream } from "./stream.js";
export {
	buildKotaModelResponse,
	extractToolResultContent,
	mapFinishReason,
	safeJsonParse,
	systemToText,
	toOpenAIMessages,
	toOpenAITools,
} from "./translations.js";
export type { OAIMessage, OAIResponse, OAIStreamChunk, OAITool, OAIToolCall } from "./types.js";
