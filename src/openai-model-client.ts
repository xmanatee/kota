/**
 * OpenAI-compatible ModelClient — thin facade re-exporting from src/openai/.
 *
 * Implementation split into focused modules:
 *   openai/types.ts        — OpenAI API type definitions
 *   openai/translations.ts — Anthropic ↔ OpenAI format conversion
 *   openai/stream.ts       — SSE stream consumer
 *   openai/client.ts       — HTTP client (OpenAIModelClient)
 */


export { type OpenAIClientOptions, OpenAIModelClient } from "./openai/client.js";
export {
	buildAnthropicMessage,
	mapFinishReason,
	systemToText,
	toOpenAIMessages,
	toOpenAITools,
} from "./openai/translations.js";
