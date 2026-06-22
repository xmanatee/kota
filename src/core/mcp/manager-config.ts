import type { KotaJsonObject, KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import type {
  McpClientTransportConfig,
  McpStdioClientTransportConfig,
  McpStreamableHttpClientTransportConfig,
} from "./client.js";
import { decodeMcpAuthorizationConfig } from "./manager-config-auth.js";
import {
  isJsonObject,
  optionalStringArray,
  optionalStringRecord,
  presentFields,
} from "./manager-config-utils.js";
import { assertValidMcpServerNamespace } from "./tool-namespace.js";

export type McpServerStdioConfig = McpStdioClientTransportConfig;
export type McpServerHttpConfig = McpStreamableHttpClientTransportConfig;
export type McpServerConfig = McpServerStdioConfig | McpServerHttpConfig;

const MCP_CONFIG_FIELDS = new Set(["type", "command", "args", "env", "url", "headers", "authorization"]);
const MCP_STDIO_FIELDS = ["command", "args", "env"] as const;
const MCP_HTTP_FIELDS = ["url", "headers", "authorization"] as const;

function assertNoUnknownConfigFields(serverName: string, raw: KotaJsonObject): void {
  const unknownFields = Object.keys(raw).filter((field) => !MCP_CONFIG_FIELDS.has(field));
  if (unknownFields.length === 0) return;
  throw new Error(
    `Invalid MCP server config for "${serverName}": unexpected field${unknownFields.length === 1 ? "" : "s"} ${unknownFields.join(", ")}`,
  );
}

function decodeTransportType(
  serverName: string,
  value: KotaJsonValue | undefined,
): "stdio" | "http" {
  if (value === undefined) return "stdio";
  if (value === "stdio" || value === "http") return value;
  throw new Error(`Invalid MCP server config for "${serverName}": type must be "stdio" or "http"`);
}

export function normalizeMcpServerConfig(
  serverName: string,
  config: McpServerConfig,
): McpClientTransportConfig {
  assertValidMcpServerNamespace(serverName);
  if (!isJsonObject(config)) {
    throw new Error(`Invalid MCP server config for "${serverName}": config must be an object`);
  }
  const raw = config as KotaJsonObject;
  assertNoUnknownConfigFields(serverName, raw);
  const type = decodeTransportType(serverName, raw.type);
  if (type === "stdio") {
    const httpFields = presentFields(raw, MCP_HTTP_FIELDS);
    if (httpFields.length > 0) {
      throw new Error(
        `Invalid MCP server config for "${serverName}": stdio transport cannot define http field${httpFields.length === 1 ? "" : "s"} ${httpFields.join(", ")}`,
      );
    }
    if (typeof raw.command !== "string" || raw.command.length === 0) {
      throw new Error(`Invalid MCP server config for "${serverName}": stdio transport requires command`);
    }
    const args = optionalStringArray(raw.args, "args");
    const env = optionalStringRecord(raw.env, "env");
    return {
      type: "stdio",
      command: raw.command,
      ...(args ? { args } : {}),
      ...(env ? { env } : {}),
    };
  }
  const stdioFields = presentFields(raw, MCP_STDIO_FIELDS);
  if (stdioFields.length > 0) {
    throw new Error(`Invalid MCP server config for "${serverName}": http transport cannot also define stdio fields`);
  }
  if (typeof raw.url !== "string" || raw.url.length === 0) {
    throw new Error(`Invalid MCP server config for "${serverName}": http transport requires url`);
  }
  const headers = optionalStringRecord(raw.headers, "headers");
  const authorization = decodeMcpAuthorizationConfig(raw.authorization, headers);
  return {
    type: "http",
    url: raw.url,
    ...(headers ? { headers } : {}),
    ...(authorization ? { authorization } : {}),
  };
}
