export const MCP_MANAGED_TOOL_PREFIX = "mcp__";

export function isMcpManagedToolName(name: string): boolean {
  return name.startsWith(MCP_MANAGED_TOOL_PREFIX);
}

export function mcpManagedToolNameError(name: string): string {
  return `Tool name "${name}" uses the reserved MCP-managed prefix "${MCP_MANAGED_TOOL_PREFIX}"`;
}

export function assertNotMcpManagedToolName(name: string): void {
  if (isMcpManagedToolName(name)) {
    throw new Error(mcpManagedToolNameError(name));
  }
}
