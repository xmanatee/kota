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
 * Neutral tool-definition shape. A tool is a name, a description, and a
 * JSON-Schema `input_schema`. Harness adapters that target an SDK whose tool
 * type is the same JSON shape (Anthropic SDK, OpenAI chat-completions tools)
 * pass this value through or translate it at their seam; core consumes only
 * `KotaTool`.
 */
export type KotaTool = {
  name: string;
  description: string;
  input_schema: KotaToolInputSchema;
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

/** Neutral text content block. */
export type KotaTextBlock = {
  type: "text";
  text: string;
  cache_control?: KotaCacheControl;
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
export type KotaToolResultBlockContent =
  | string
  | Array<KotaTextBlock | KotaImageBlock>;

/** Neutral tool-result content block. */
export type KotaToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: KotaToolResultBlockContent;
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
