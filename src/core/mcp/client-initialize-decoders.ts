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
  MCP_CURRENT_PROTOCOL_VERSION,
  MCP_DRAFT_PROTOCOL_VERSION,
  MCP_LEGACY_PROTOCOL_VERSION,
  MCP_MODERN_PROTOCOL_VERSIONS,
  MCP_SKILLS_EXTENSION_ID,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  MCP_TASKS_EXTENSION_ID,
  mcpProtocolSupports,
} from "./client-protocol.js";

function decodeExtensionSupport(
  capabilities: ReturnType<typeof optionalJsonObject>,
  extensionId: string,
  kind: "initialize" | "server/discover",
): boolean {
  const extensions = capabilities
    ? optionalJsonObject(capabilities.extensions, "capabilities.extensions", kind)
    : undefined;
  const rawExtension = extensions ? extensions[extensionId] : undefined;
  if (rawExtension === undefined) return false;
  optionalJsonObject(
    rawExtension,
    `capabilities.extensions.${extensionId}`,
    kind,
  );
  return true;
}

export function decodeInitializeResult(value: JsonRpcResponse["result"]): McpInitializeResult {
  const object = requireJsonObject(value, "result", "initialize");
  const protocolVersion = requireString(
    object.protocolVersion,
    "protocolVersion",
    "initialize",
  );
  if (!isMcpProtocolVersion(protocolVersion)) {
    throw new Error(
      `Malformed MCP initialize result: protocolVersion must be ${MCP_SUPPORTED_PROTOCOL_VERSIONS.join(" or ")}`,
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
  const tasksSupported = mcpProtocolSupports(protocolVersion, "tasksExtension") &&
    decodeExtensionSupport(capabilities, MCP_TASKS_EXTENSION_ID, "initialize");
  const skillsSupported = mcpProtocolSupports(protocolVersion, "skillsExtension") &&
    decodeExtensionSupport(capabilities, MCP_SKILLS_EXTENSION_ID, "initialize");
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
    tasksSupported,
    skillsSupported,
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
  const protocolVersion = supportedVersions?.includes(MCP_CURRENT_PROTOCOL_VERSION)
    ? MCP_CURRENT_PROTOCOL_VERSION
    : supportedVersions?.includes(MCP_DRAFT_PROTOCOL_VERSION)
      ? MCP_DRAFT_PROTOCOL_VERSION
      : null;
  if (protocolVersion === null) {
    throw new Error(
      `Malformed MCP server/discover result: supportedVersions must include ${MCP_MODERN_PROTOCOL_VERSIONS.join(" or ")}`,
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
  const tasksSupported = mcpProtocolSupports(protocolVersion, "tasksExtension") &&
    decodeExtensionSupport(
    capabilities,
    MCP_TASKS_EXTENSION_ID,
    "server/discover",
  );
  const skillsSupported = mcpProtocolSupports(protocolVersion, "skillsExtension") &&
    decodeExtensionSupport(
    capabilities,
    MCP_SKILLS_EXTENSION_ID,
    "server/discover",
  );
  const rawServerInfo = optionalJsonObject(
    object.serverInfo,
    "serverInfo",
    "server/discover",
  );
  const name = rawServerInfo
    ? optionalString(rawServerInfo.name, "serverInfo.name", "server/discover")
    : undefined;
  return {
    protocolVersion,
    toolsSupported: tools.supported,
    toolsListChanged: tools.listChanged,
    resourcesSupported: resources.supported,
    resourcesListChanged: resources.listChanged,
    promptsSupported: prompts.supported,
    promptsListChanged: prompts.listChanged,
    loggingSupported,
    tasksSupported,
    skillsSupported,
    ...(rawServerInfo ? { serverInfo: { ...(name !== undefined ? { name } : {}) } } : {}),
  };
}
