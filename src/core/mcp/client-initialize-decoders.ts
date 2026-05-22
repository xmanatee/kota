import {
  decodeDeprecatedObjectCapability,
  decodeListChangedCapability,
  isMcpProtocolVersion,
  optionalJsonObject,
  optionalString,
  optionalStringArray,
  requireJsonObject,
  requireString,
} from "./client-decode-utils.js";
import type { JsonRpcResponse, McpInitializeResult } from "./client-protocol.js";
import {
  MCP_DRAFT_PROTOCOL_VERSION,
  MCP_LEGACY_PROTOCOL_VERSION,
} from "./client-protocol.js";

export function decodeInitializeResult(value: JsonRpcResponse["result"]): McpInitializeResult {
  const object = requireJsonObject(value, "result", "initialize");
  const protocolVersion = requireString(
    object.protocolVersion,
    "protocolVersion",
    "initialize",
  );
  if (!isMcpProtocolVersion(protocolVersion)) {
    throw new Error(
      `Malformed MCP initialize result: protocolVersion must be ${MCP_DRAFT_PROTOCOL_VERSION} or ${MCP_LEGACY_PROTOCOL_VERSION}`,
    );
  }
  const capabilities = optionalJsonObject(
    object.capabilities,
    "capabilities",
    "initialize",
  );
  const tools = decodeListChangedCapability(capabilities, "tools", "initialize");
  const resources = decodeListChangedCapability(capabilities, "resources", "initialize");
  const prompts = decodeListChangedCapability(capabilities, "prompts", "initialize");
  const loggingSupported = decodeDeprecatedObjectCapability(capabilities, "logging", "initialize");
  const rawServerInfo = optionalJsonObject(
    object.serverInfo,
    "serverInfo",
    "initialize",
  );
  const name = rawServerInfo
    ? optionalString(rawServerInfo.name, "serverInfo.name", "initialize")
    : undefined;
  return {
    protocolVersion,
    toolsSupported: protocolVersion === MCP_LEGACY_PROTOCOL_VERSION || tools.supported,
    toolsListChanged: tools.listChanged,
    resourcesSupported: resources.supported,
    resourcesListChanged: resources.listChanged,
    promptsSupported: prompts.supported,
    promptsListChanged: prompts.listChanged,
    loggingSupported,
    ...(rawServerInfo ? { serverInfo: { ...(name !== undefined ? { name } : {}) } } : {}),
  };
}

export function decodeDiscoverResult(value: JsonRpcResponse["result"]): McpInitializeResult {
  const object = requireJsonObject(value, "result", "server/discover");
  const supportedVersions = optionalStringArray(
    object.supportedVersions,
    "supportedVersions",
    "server/discover",
  );
  if (!supportedVersions?.includes(MCP_DRAFT_PROTOCOL_VERSION)) {
    throw new Error(
      `Malformed MCP server/discover result: supportedVersions must include ${MCP_DRAFT_PROTOCOL_VERSION}`,
    );
  }
  const capabilities = optionalJsonObject(
    object.capabilities,
    "capabilities",
    "server/discover",
  );
  const tools = decodeListChangedCapability(capabilities, "tools", "server/discover");
  const resources = decodeListChangedCapability(capabilities, "resources", "server/discover");
  const prompts = decodeListChangedCapability(capabilities, "prompts", "server/discover");
  const loggingSupported = decodeDeprecatedObjectCapability(capabilities, "logging", "server/discover");
  const rawServerInfo = optionalJsonObject(
    object.serverInfo,
    "serverInfo",
    "server/discover",
  );
  const name = rawServerInfo
    ? optionalString(rawServerInfo.name, "serverInfo.name", "server/discover")
    : undefined;
  return {
    protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
    toolsSupported: tools.supported,
    toolsListChanged: tools.listChanged,
    resourcesSupported: resources.supported,
    resourcesListChanged: resources.listChanged,
    promptsSupported: prompts.supported,
    promptsListChanged: prompts.listChanged,
    loggingSupported,
    ...(rawServerInfo ? { serverInfo: { ...(name !== undefined ? { name } : {}) } } : {}),
  };
}
