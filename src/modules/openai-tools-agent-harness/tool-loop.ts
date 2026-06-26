import type {
  KotaContentBlock,
  KotaTextBlock,
  KotaTool,
  KotaToolUseBlock,
} from "#core/agent-harness/index.js";
import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import { getAllTools } from "#core/tools/index.js";
import { OPENAI_TOOLS_ASK_OWNER_TOOL_NAME } from "./constants.js";

export function isToolUseBlock(block: KotaContentBlock): block is KotaToolUseBlock {
  return block.type === "tool_use";
}

export function isTextBlock(block: KotaContentBlock): block is KotaTextBlock {
  return block.type === "text";
}

export type ValidatedToolUseBlock = KotaToolUseBlock & {
  input: KotaJsonObject;
};

function isPlainToolInput(
  value: KotaToolUseBlock["input"] | undefined,
): value is KotaJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeRawFallback(input: KotaToolUseBlock["input"]): boolean {
  if (!isPlainToolInput(input)) return false;
  const keys = Object.keys(input);
  return (
    keys.length === 1 &&
    keys[0] === "_raw" &&
    typeof Reflect.get(input, "_raw") === "string"
  );
}

export function validateToolUseBlock(call: KotaToolUseBlock): ValidatedToolUseBlock {
  if (typeof call.name !== "string" || call.name.length === 0) {
    throw new Error(
      `OpenAI model returned a malformed tool_call: missing tool name (id=${String(call.id)}).`,
    );
  }
  if (looksLikeRawFallback(call.input)) {
    throw new Error(
      `OpenAI model returned malformed JSON arguments for tool "${call.name}" ` +
        "(non-parseable JSON in tool_call.function.arguments).",
    );
  }
  if (!isPlainToolInput(call.input)) {
    throw new Error(
      `OpenAI model returned a malformed tool_call for "${call.name}": input must be a JSON object, got ${
        call.input === null
          ? "null"
          : Array.isArray(call.input)
            ? "array"
            : typeof call.input
      }.`,
    );
  }
  return call as ValidatedToolUseBlock;
}

export function selectToolDefinitions(
  allowed: readonly string[] | undefined,
  disallowed: readonly string[] | undefined,
  includeAskOwner: boolean,
  mcpTools: readonly KotaTool[] = [],
): KotaTool[] {
  const all = [...getAllTools(), ...mcpTools];
  const denySet = new Set(disallowed ?? []);
  const allowSet = allowed && allowed.length > 0 ? new Set(allowed) : null;
  if (includeAskOwner && allowSet) {
    allowSet.add(OPENAI_TOOLS_ASK_OWNER_TOOL_NAME);
  }
  return all.filter((tool) => {
    if (denySet.has(tool.name)) return false;
    if (allowSet && !allowSet.has(tool.name)) return false;
    return true;
  });
}
