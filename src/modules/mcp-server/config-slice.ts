/**
 * MCP Server module config slice.
 *
 * Owns the top-level `mcp` field — MCP sampling configuration. Other MCP
 * server settings live under the per-module `config.modules.mcp-server`
 * key, but `mcp.sampling` is exposed at the top level because it is a
 * cross-cutting capability handshake (KOTA acts as the LLM completion
 * server for MCP clients).
 */

import { type ModuleConfigSlice, registerConfigSlice } from "#core/config/config-slice.js";

export type McpSamplingConfig = {
  /** Enable the sampling/createMessage handler. Default: false. */
  enabled?: boolean;
};

export type McpConfig = {
  /** Sampling settings — allow MCP clients to delegate completions to KOTA. */
  sampling?: McpSamplingConfig;
};

declare module "#core/config/config-slice.js" {
  interface KotaModuleConfigRegistry {
    mcp: McpConfig;
  }
}

function sanitizeMcp(raw: unknown): McpConfig | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const m: McpConfig = {};
  if (typeof src.sampling === "object" && src.sampling !== null && !Array.isArray(src.sampling)) {
    const samp = src.sampling as Record<string, unknown>;
    const s: McpSamplingConfig = {};
    if (typeof samp.enabled === "boolean") s.enabled = samp.enabled;
    if (Object.keys(s).length > 0) m.sampling = s;
  }
  return Object.keys(m).length > 0 ? m : undefined;
}

export const mcpConfigSlice: ModuleConfigSlice<"mcp"> = {
  key: "mcp",
  description: "MCP server and sampling configuration",
  sanitize: sanitizeMcp,
  merge: (base, override) => ({ ...base, ...override }),
  schemaSource: {
    relativePath: "src/modules/mcp-server/config-slice.ts",
    typeName: "McpConfig",
  },
};

registerConfigSlice(mcpConfigSlice, "mcp-server");
