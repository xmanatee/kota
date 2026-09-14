import type { KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import { maskKnownSecretValues } from "#core/config/secrets.js";
import type { ToolResultBlock } from "./tool-result.js";

type MaskableToolResult = {
  content: string;
  blocks?: ToolResultBlock[];
  structuredContent?: KotaJsonValue;
};

function maskStructuredSecrets(value: KotaJsonValue): KotaJsonValue {
  if (typeof value === "string") return maskKnownSecretValues(value);
  if (Array.isArray(value)) return value.map(maskStructuredSecrets);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      maskKnownSecretValues(key),
      maskStructuredSecrets(nested),
    ]),
  );
}

// Mask the agent projection only, after the runner validates authoritative output.
export function maskToolResultSecrets<T extends MaskableToolResult>(result: T): T {
  const content = maskKnownSecretValues(result.content);
  const blocks = result.blocks?.map((block) =>
    block.type === "text"
      ? { ...block, text: maskKnownSecretValues(block.text) }
      : block,
  );

  return {
    ...result,
    content,
    ...(blocks ? { blocks } : {}),
    ...(result.structuredContent !== undefined
      ? { structuredContent: maskStructuredSecrets(result.structuredContent) }
      : {}),
  } as T;
}
