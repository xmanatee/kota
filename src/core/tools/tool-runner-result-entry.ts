import type { ToolResult } from "./index.js";
import type {
  ToolResultEntry,
  ValidatedToolUseBlock,
} from "./tool-runner-types.js";

export function toolResultEntry(
  block: ValidatedToolUseBlock,
  result: ToolResult,
): ToolResultEntry {
  return {
    tool_use_id: block.id,
    content: result.content,
    ...(result.blocks ? { blocks: result.blocks } : {}),
    ...(result.structuredContent
      ? { structuredContent: result.structuredContent }
      : {}),
    ...(result._meta ? { _meta: result._meta } : {}),
    ...(result.is_error !== undefined ? { is_error: result.is_error } : {}),
  };
}

export function toolErrorEntry(
  block: ValidatedToolUseBlock,
  content: string,
): ToolResultEntry {
  return { tool_use_id: block.id, content, is_error: true };
}
