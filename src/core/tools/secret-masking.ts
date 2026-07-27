import { maskKnownSecretValues } from "#core/config/secrets.js";
import type { ToolResultBlock } from "./tool-result.js";

type MaskableToolResult = {
  content: string;
  blocks?: ToolResultBlock[];
};

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
  } as T;
}
