/**
 * Harness-neutral message/tool protocol types. Core defines every shape
 * it uses to describe tools, messages, and content blocks here; module-side
 * adapters translate between these neutral shapes and provider-native wire
 * formats at their boundary. See `anthropic-type-audit.md` for the staged
 * plan that removes `@anthropic-ai/sdk` type imports from `src/core/`.
 */

/**
 * Neutral JSON Schema object shape that describes a tool's input. The shape
 * is a plain JSON Schema `object` — structurally compatible with the shape
 * every harness speaks on the wire, so adapters that target an SDK whose
 * tool input schema is the same JSON Schema object pass this value through
 * without translation.
 */
export type KotaToolInputSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

/**
 * Neutral JSON Schema object shape for a tool's structured output. This is the
 * same strict object-schema style as `input_schema` because KOTA structured
 * tool results are JSON objects.
 */
export type KotaToolOutputSchema = KotaToolInputSchema;

/**
 * Neutral tool-definition shape. A tool is a name, a description, and a
 * JSON-Schema `input_schema`, plus an optional schema for structured output.
 * Harness adapters that target an SDK whose tool type is the same JSON shape
 * pass this value through or translate it at their seam; core consumes only
 * `KotaTool`.
 */
export type KotaTool = {
  name: string;
  description: string;
  input_schema: KotaToolInputSchema;
  output_schema?: KotaToolOutputSchema;
};

/**
 * Neutral reasoning / thinking configuration. Structurally compatible with
 * Anthropic's `ThinkingConfigParam` so adapters that target the Anthropic SDK
 * translate field-for-field at their seam; core consumes only
 * `KotaThinkingConfig`. Optional presence is expressed at the field site
 * (`thinking?: KotaThinkingConfig`), not by a nullable branch inside the
 * union.
 */
export type KotaThinkingConfig =
  | { type: "enabled"; budget_tokens: number }
  | { type: "disabled" };

/**
 * Neutral conversation-role alias. KOTA stores only user and assistant roles
 * on the transcript; system prompts travel as a separate `KotaTextBlock[]`
 * parameter alongside the message array, never as a message role.
 */
export type KotaRole = "user" | "assistant";

/**
 * Neutral cache-control marker that mirrors Anthropic's `CacheControlEphemeral`
 * on text and tool-result blocks. Providers without a cache-control mechanism
 * ignore the field at their adapter seam.
 */
export type KotaCacheControl = { type: "ephemeral" };

/** JSON value shape used for structured tool output and protocol metadata. */
export type KotaJsonValue =
  | string
  | number
  | boolean
  | null
  | KotaJsonValue[]
  | { [key: string]: KotaJsonValue };

/** JSON object shape for structured tool output and protocol metadata. */
export type KotaJsonObject = { [key: string]: KotaJsonValue };

/** MCP content annotations preserved on neutral tool-result blocks. */
export type KotaMcpAnnotations = {
  audience?: KotaRole[];
  priority?: number;
  lastModified?: string;
};

/** Neutral text content block. */
export type KotaTextBlock = {
  type: "text";
  text: string;
  cache_control?: KotaCacheControl;
  annotations?: KotaMcpAnnotations;
  _meta?: KotaJsonObject;
};

/**
 * Neutral tool-use content block. Emitted by the assistant when it invokes a
 * tool. `input` is `unknown` because the schema lives on the tool definition,
 * not the block.
 */
export type KotaToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};

/** Neutral base64-encoded image block. */
export type KotaImageBlock = {
  type: "image";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
  annotations?: KotaMcpAnnotations;
  _meta?: KotaJsonObject;
};

export type KotaMcpTextResourceContents = {
  uri: string;
  mimeType?: string;
  text: string;
  _meta?: KotaJsonObject;
};

export type KotaMcpBlobResourceContents = {
  uri: string;
  mimeType?: string;
  blob: string;
  _meta?: KotaJsonObject;
};

export type KotaMcpResourceContents =
  | KotaMcpTextResourceContents
  | KotaMcpBlobResourceContents;

export type KotaMcpIcon = {
  src: string;
  mimeType?: string;
  sizes?: string[];
  theme?: "light" | "dark";
};

/**
 * MCP content kinds that KOTA's current provider adapters cannot represent
 * directly. The neutral transcript keeps them explicit so adapter seams can
 * reject them loudly instead of erasing them during MCP routing.
 */
export type KotaMcpPreservedContent =
  | {
      type: "audio";
      data: string;
      mimeType: string;
      annotations?: KotaMcpAnnotations;
      _meta?: KotaJsonObject;
    }
  | {
      type: "resource";
      resource: KotaMcpResourceContents;
      annotations?: KotaMcpAnnotations;
      _meta?: KotaJsonObject;
    }
  | {
      type: "resource_link";
      uri: string;
      name: string;
      title?: string;
      description?: string;
      mimeType?: string;
      size?: number;
      icons?: KotaMcpIcon[];
      annotations?: KotaMcpAnnotations;
      _meta?: KotaJsonObject;
    }
  | {
      type: "unknown";
      mcpType: string;
      raw: KotaJsonObject;
    };

/** Neutral wrapper for MCP content that has no model-provider block analog. */
export type KotaMcpPreservedContentBlock = {
  type: "mcp_content";
  content: KotaMcpPreservedContent;
};

/**
 * Neutral assistant thinking block. Assistant responses that carry extended
 * thinking traces include these alongside text and tool_use blocks, and the
 * loop round-trips them back to the provider on subsequent turns. Providers
 * without a thinking channel drop them at their adapter seam.
 */
export type KotaThinkingBlock = {
  type: "thinking";
  thinking: string;
  signature: string;
};

/**
 * Content accepted inside a `KotaToolResultBlock`. Providers may send tool
 * results as plain text or as a list of structured blocks (text + image) when
 * the tool produced a rich payload.
 */
export type KotaToolResultContentBlock =
  | KotaTextBlock
  | KotaImageBlock
  | KotaMcpPreservedContentBlock;

export type KotaToolResultBlockContent =
  | string
  | KotaToolResultContentBlock[];

/** Neutral tool-result content block. */
export type KotaToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: KotaToolResultBlockContent;
  structuredContent?: KotaJsonObject;
  _meta?: KotaJsonObject;
  is_error?: boolean;
};

/**
 * Neutral discriminated union over every content block that can appear in a
 * transcript message. Callers narrow on `block.type` — there is no
 * "either text or tool_use" optional-field form.
 */
export type KotaContentBlock =
  | KotaTextBlock
  | KotaToolUseBlock
  | KotaToolResultBlock
  | KotaImageBlock
  | KotaThinkingBlock;

/**
 * Neutral transcript message. `content` is `string | KotaContentBlock[]` to
 * match the "bare string shortcut" the history store and the loop both rely
 * on for simple user/assistant turns; forcing every message to a block list
 * would be a separate simplification outside this protocol's scope.
 */
export type KotaMessage = {
  role: KotaRole;
  content: string | KotaContentBlock[];
};

/**
 * Neutral usage accounting shared by every `ModelClient` implementation.
 * `cache_*` fields stay nullable because the Anthropic wire exposes them as
 * `number | null` and the usage-accounting path reads them verbatim.
 * Providers that do not have cache accounting leave them `null`.
 */
export type KotaModelUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

/**
 * Neutral stop-reason union. Providers whose native stop reason falls outside
 * this union translate at their adapter seam; core never widens the type.
 */
export type KotaStopReason =
  | "end_turn"
  | "max_tokens"
  | "stop_sequence"
  | "tool_use"
  | "pause_turn"
  | "refusal";

/**
 * Neutral assistant-response shape. Every `ModelClient.messages.stream()` and
 * `ModelClient.messages.create()` implementation returns this directly;
 * provider-native message shapes only live behind the adapter seam.
 */
export type KotaModelResponse = {
  id: string;
  role: "assistant";
  model: string;
  content: KotaContentBlock[];
  stop_reason: KotaStopReason | null;
  stop_sequence?: string | null;
  usage: KotaModelUsage;
};

/**
 * Neutral streaming interface. Core only reads `text` and `thinking` deltas
 * and the final message; provider-native streams expose more events that are
 * not part of this surface.
 */
export interface KotaMessageStream {
  on(event: "text", cb: (delta: string) => void): this;
  on(event: "thinking", cb: (delta: string) => void): this;
  finalMessage(): Promise<KotaModelResponse>;
}
