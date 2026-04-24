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
