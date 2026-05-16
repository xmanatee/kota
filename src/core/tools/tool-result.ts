/**
 * ToolResult — the return type for all tool runners.
 *
 * Defined here rather than in tools/index.ts so that the KotaModule protocol
 * (module-types.ts) and external adapters (tool-adapters.ts) can depend on
 * this type without pulling in the entire tool implementation bundle.
 */

import type {
  KotaJsonObject,
  KotaToolResultContentBlock,
} from "#core/agent-harness/message-protocol.js";

export type ToolResultBlock = KotaToolResultContentBlock;

export type ToolResult = {
  content: string;
  blocks?: ToolResultBlock[];
  structuredContent?: KotaJsonObject;
  _meta?: KotaJsonObject;
  is_error?: boolean;
};
