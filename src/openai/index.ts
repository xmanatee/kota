/**
 * OpenAI-compatible ModelClient — translates between Anthropic message format
 * (used internally by KOTA) and the OpenAI chat completions API format.
 */

export { type OpenAIClientOptions, OpenAIModelClient } from "./client.js";
export { OpenAIStream } from "./stream.js";
export {
	buildAnthropicMessage,
	extractToolResultContent,
	mapFinishReason,
	safeJsonParse,
	systemToText,
	toOpenAIMessages,
	toOpenAITools,
} from "./translations.js";
export type { OAIMessage, OAIResponse, OAIStreamChunk, OAITool, OAIToolCall } from "./types.js";
