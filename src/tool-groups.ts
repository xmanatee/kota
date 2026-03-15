import type Anthropic from "@anthropic-ai/sdk";

export const TOOL_GROUPS: Record<string, string[]> = {
  web: ["web_search", "web_fetch", "http_request"],
  code: ["code_exec"],
  advanced_editing: ["multi_edit", "find_replace", "repo_map"],
  management: ["todo", "memory", "process"],
};

export const CORE_TOOL_NAMES = new Set([
  "shell",
  "file_read",
  "file_write",
  "file_edit",
  "grep",
  "glob",
  "ask_user",
  "delegate",
  "enable_tools",
]);

const enabledGroups = new Set<string>();

export function enableGroup(name: string): { tools: string[]; error?: string } {
  if (name === "all") {
    for (const g of Object.keys(TOOL_GROUPS)) enabledGroups.add(g);
    return { tools: Object.values(TOOL_GROUPS).flat() };
  }
  const tools = TOOL_GROUPS[name];
  if (!tools) {
    return {
      tools: [],
      error: `Unknown group "${name}". Available: ${Object.keys(TOOL_GROUPS).join(", ")}, all`,
    };
  }
  enabledGroups.add(name);
  return { tools };
}

export function getActiveToolNames(): Set<string> {
  const names = new Set(CORE_TOOL_NAMES);
  for (const group of enabledGroups) {
    for (const tool of TOOL_GROUPS[group] ?? []) names.add(tool);
  }
  return names;
}

export function filterTools(tools: Anthropic.Tool[]): Anthropic.Tool[] {
  const active = getActiveToolNames();
  const filtered = tools.filter((t) => active.has(t.name));
  // enable_tools is not in allTools but must always be available
  if (!filtered.some((t) => t.name === "enable_tools")) {
    filtered.push(enableToolsTool);
  }
  return filtered;
}

export function resetGroups(): void {
  enabledGroups.clear();
}

export function getEnabledGroups(): string[] {
  return [...enabledGroups].sort();
}

const GROUP_DESCRIPTIONS = Object.entries(TOOL_GROUPS)
  .map(([name, tools]) => `- ${name}: ${tools.join(", ")}`)
  .join("\n");

const CORE_LIST = [...CORE_TOOL_NAMES]
  .filter((n) => n !== "enable_tools")
  .sort()
  .join(", ");

export const enableToolsTool: Anthropic.Tool = {
  name: "enable_tools",
  description:
    `Enable additional tool groups. Call this before using specialized tools.\n\nGroups:\n${GROUP_DESCRIPTIONS}\n- all: enable everything\n\nCore (always available): ${CORE_LIST}`,
  input_schema: {
    type: "object" as const,
    properties: {
      groups: {
        type: "array",
        items: { type: "string" },
        description: 'Groups to enable, e.g. ["web", "code"]',
      },
    },
    required: ["groups"],
  },
};

export async function runEnableTools(
  input: Record<string, unknown>,
): Promise<{ content: string; is_error?: boolean }> {
  const groups = input.groups as string[];
  if (!Array.isArray(groups) || groups.length === 0) {
    return { content: "Provide at least one group name.", is_error: true };
  }

  const enabled: string[] = [];
  const errors: string[] = [];

  for (const g of groups) {
    const result = enableGroup(g);
    if (result.error) errors.push(result.error);
    else enabled.push(...result.tools);
  }

  if (errors.length > 0) {
    return { content: errors.join("\n"), is_error: true };
  }

  return {
    content: `Enabled: ${[...new Set(enabled)].sort().join(", ")}. These tools are now available.`,
  };
}
