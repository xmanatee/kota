import type { KotaJsonObject, KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import type {
  DeprecatedMcpFeature,
  JsonRpcId,
  JsonRpcIncomingMessage,
  JsonRpcResponse,
  McpCacheHints,
  McpCacheScope,
  McpLogLevel,
  McpProgressToken,
  McpProtocolVersion,
  McpResultKind,
} from "./client-protocol.js";
import {
  MCP_DRAFT_PROTOCOL_VERSION,
  MCP_LEGACY_PROTOCOL_VERSION,
  MCP_LOG_LEVELS,
} from "./client-protocol.js";

export function isJsonValue(value: JsonRpcResponse["result"]): value is KotaJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  return Object.values(value).every(isJsonValue);
}

export function isJsonObject(value: JsonRpcResponse["result"]): value is KotaJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonRpcId(value: JsonRpcIncomingMessage["id"]): value is JsonRpcId {
  return typeof value === "string" || (typeof value === "number" && Number.isInteger(value));
}

export function formatJsonRpcId(value: JsonRpcId): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function malformedMcpResult(kind: McpResultKind, label: string, expected: string): Error {
  return new Error(`Malformed MCP ${kind} result: ${label} must be ${expected}`);
}

export function requireJsonObject(
  value: JsonRpcResponse["result"],
  label: string,
  kind: McpResultKind = "tools/call",
): KotaJsonObject {
  if (!isJsonObject(value)) {
    throw malformedMcpResult(kind, label, "an object");
  }
  return value;
}

export function requireString(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): string {
  if (typeof value !== "string") {
    throw malformedMcpResult(kind, label, "a string");
  }
  return value;
}

export function requireStringArray(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw malformedMcpResult(kind, label, "a string array");
  }
  return value;
}

export function optionalString(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw malformedMcpResult(kind, label, "a string");
  }
  return value;
}

export function optionalNumber(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number") {
    throw malformedMcpResult(kind, label, "a number");
  }
  return value;
}

export function optionalBoolean(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw malformedMcpResult(kind, label, "a boolean");
  }
  return value;
}

export function optionalStringArray(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw malformedMcpResult(kind, label, "a string array");
  }
  return value;
}

export function optionalJsonObject(
  value: KotaJsonValue | undefined,
  label: string,
  kind: McpResultKind = "tools/call",
): KotaJsonObject | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) {
    throw malformedMcpResult(kind, label, "an object");
  }
  return value;
}

export function decodeCacheHints(
  object: KotaJsonObject,
  kind: McpResultKind,
): McpCacheHints {
  const rawTtlMs = optionalNumber(object.ttlMs, "ttlMs", kind);
  if (rawTtlMs !== undefined && !Number.isFinite(rawTtlMs)) {
    throw malformedMcpResult(kind, "ttlMs", "a finite number");
  }
  const rawCacheScope = object.cacheScope;
  let cacheScope: McpCacheScope = "private";
  if (rawCacheScope !== undefined) {
    if (rawCacheScope !== "public" && rawCacheScope !== "private") {
      throw new Error(
        `Malformed MCP ${kind} result: cacheScope must be "public" or "private"`,
      );
    }
    cacheScope = rawCacheScope;
  }
  return {
    ttlMs: rawTtlMs === undefined ? 0 : Math.max(0, rawTtlMs),
    cacheScope,
  };
}

export function decodeListChangedCapability(
  capabilities: KotaJsonObject | undefined,
  capabilityName: "tools" | "resources" | "prompts",
  kind: McpResultKind,
): { supported: boolean; listChanged: boolean } {
  const rawCapability = capabilities ? capabilities[capabilityName] : undefined;
  const capability = rawCapability !== undefined
    ? optionalJsonObject(rawCapability, `capabilities.${capabilityName}`, kind)
    : undefined;
  return {
    supported: capability !== undefined,
    listChanged: capability
      ? optionalBoolean(
        capability.listChanged,
        `capabilities.${capabilityName}.listChanged`,
        kind,
      ) === true
      : false,
  };
}

export function decodeDeprecatedObjectCapability(
  capabilities: KotaJsonObject | undefined,
  capabilityName: DeprecatedMcpFeature,
  kind: McpResultKind,
): boolean {
  const rawCapability = capabilities ? capabilities[capabilityName] : undefined;
  if (rawCapability === undefined) return false;
  optionalJsonObject(rawCapability, `capabilities.${capabilityName}`, kind);
  return true;
}

export function isMcpProtocolVersion(value: string): value is McpProtocolVersion {
  return value === MCP_DRAFT_PROTOCOL_VERSION || value === MCP_LEGACY_PROTOCOL_VERSION;
}

export function isMcpProgressToken(value: KotaJsonValue | undefined): value is McpProgressToken {
  return typeof value === "string" || (typeof value === "number" && Number.isInteger(value));
}

export function isMcpLogLevel(value: KotaJsonValue | undefined): value is McpLogLevel {
  return typeof value === "string" &&
    (MCP_LOG_LEVELS as readonly string[]).includes(value);
}

export function progressTokenKey(token: McpProgressToken): string {
  return `${typeof token}:${String(token)}`;
}

export function generatedProgressToken(requestId: number): McpProgressToken {
  return `kota-progress-${requestId}`;
}

export function isUnsupportedProtocolVersionError(err: Error): boolean {
  return /MCP error -32602: Unsupported protocol version/.test(err.message);
}
