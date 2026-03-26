/**
 * ToolResult — the return type for all tool runners.
 *
 * Defined here rather than in tools/index.ts so that the KotaExtension protocol
 * (module-types.ts) and external adapters (tool-adapters.ts) can depend on
 * this type without pulling in the entire tool implementation bundle.
 */

export type ToolResultBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export type ToolResult = {
  content: string;
  blocks?: ToolResultBlock[];
  is_error?: boolean;
};
