import { getSecretStore } from "#core/config/secrets.js";
import type { ToolResultBlock } from "./tool-result.js";

type MaskableToolResult = {
  content: string;
  blocks?: ToolResultBlock[];
};

export function maskToolResultSecrets<T extends MaskableToolResult>(result: T): T {
  const secretStore = getSecretStore();
  if (!secretStore) return result;

  const mask = (text: string) => secretStore.mask(text);
  const content = mask(result.content);
  const blocks = result.blocks?.map((block) =>
    block.type === "text" ? { ...block, text: mask(block.text) } : block,
  );

  return {
    ...result,
    content,
    ...(blocks ? { blocks } : {}),
  } as T;
}
