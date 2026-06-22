const MCP_NAMESPACE_SEPARATOR = "__";
const MCP_NAMESPACE_SEPARATOR_EDGE = "_";

function rejectInvalidNamespacePart(kind: string, value: string): void {
  if (value.length === 0) {
    throw new Error(`Invalid MCP ${kind}: value must be non-empty`);
  }
  if (value.includes(MCP_NAMESPACE_SEPARATOR)) {
    throw new Error(
      `Invalid MCP ${kind} "${value}": namespaced MCP names reserve "${MCP_NAMESPACE_SEPARATOR}"`,
    );
  }
}

export function assertValidMcpServerNamespace(serverName: string): void {
  rejectInvalidNamespacePart("server config name", serverName);
  if (serverName.endsWith(MCP_NAMESPACE_SEPARATOR_EDGE)) {
    throw new Error(
      `Invalid MCP server config name "${serverName}": namespaced MCP server config names cannot end with "${MCP_NAMESPACE_SEPARATOR_EDGE}"`,
    );
  }
}

export function assertValidMcpToolNamespace(serverName: string, toolName: string): void {
  try {
    rejectInvalidNamespacePart("tool name", toolName);
  } catch (err) {
    throw new Error(`Invalid MCP tool name from server "${serverName}": ${(err as Error).message}`);
  }
}

export function namespaceTool(serverName: string, toolName: string): string {
  assertValidMcpServerNamespace(serverName);
  assertValidMcpToolNamespace(serverName, toolName);
  return `mcp${MCP_NAMESPACE_SEPARATOR}${serverName}${MCP_NAMESPACE_SEPARATOR}${toolName}`;
}

export function namespaceResourceOperation(serverName: string, action: "list" | "read"): string {
  assertValidMcpServerNamespace(serverName);
  return `mcp_resources${MCP_NAMESPACE_SEPARATOR}${serverName}${MCP_NAMESPACE_SEPARATOR}${action}`;
}

export function namespaceResourceTemplateOperation(serverName: string): string {
  assertValidMcpServerNamespace(serverName);
  return `mcp_resource_templates${MCP_NAMESPACE_SEPARATOR}${serverName}${MCP_NAMESPACE_SEPARATOR}list`;
}

export function namespacePromptOperation(serverName: string, action: "list" | "get"): string {
  assertValidMcpServerNamespace(serverName);
  return `mcp_prompts${MCP_NAMESPACE_SEPARATOR}${serverName}${MCP_NAMESPACE_SEPARATOR}${action}`;
}

export function namespaceSkillOperation(serverName: string, action: "list" | "read"): string {
  assertValidMcpServerNamespace(serverName);
  return `mcp_skills${MCP_NAMESPACE_SEPARATOR}${serverName}${MCP_NAMESPACE_SEPARATOR}${action}`;
}

export function parseToolName(name: string): { server: string; tool: string } | null {
  const prefix = `mcp${MCP_NAMESPACE_SEPARATOR}`;
  if (!name.startsWith(prefix)) return null;
  const rest = name.slice(prefix.length);
  const separatorIndex = rest.indexOf(MCP_NAMESPACE_SEPARATOR);
  if (separatorIndex <= 0) return null;
  const server = rest.slice(0, separatorIndex);
  const tool = rest.slice(separatorIndex + MCP_NAMESPACE_SEPARATOR.length);
  if (!server || !tool) return null;
  return { server, tool };
}

export function firstDuplicateMcpToolName(names: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) return name;
    seen.add(name);
  }
  return null;
}
