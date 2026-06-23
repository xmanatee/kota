export const MCP_MANAGED_TOOL_PREFIX = "mcp__";
export const MCP_MANAGED_OPERATION_TOOL_PREFIXES = [
  "mcp_resources__",
  "mcp_resource_templates__",
  "mcp_prompts__",
  "mcp_skills__",
] as const;

const MCP_MANAGED_TOOL_PREFIXES = [
  MCP_MANAGED_TOOL_PREFIX,
  ...MCP_MANAGED_OPERATION_TOOL_PREFIXES,
] as const;

export function isMcpManagedToolName(name: string): boolean {
  return MCP_MANAGED_TOOL_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function mcpManagedToolNameError(name: string): string {
  const prefix = MCP_MANAGED_TOOL_PREFIXES.find((candidate) => name.startsWith(candidate)) ??
    MCP_MANAGED_TOOL_PREFIX;
  return `Tool name "${name}" uses the reserved MCP-managed prefix "${prefix}"`;
}

export function assertNotMcpManagedToolName(name: string): void {
  if (isMcpManagedToolName(name)) {
    throw new Error(mcpManagedToolNameError(name));
  }
}
