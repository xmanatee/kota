import type Anthropic from "@anthropic-ai/sdk";

export const TOOL_GROUPS: Record<string, string[]> = {
  web: ["web_search", "web_fetch", "http_request"],
  code: ["code_exec", "notebook"],
  advanced_editing: ["multi_edit", "find_replace", "repo_map"],
  management: ["todo", "process", "schedule"],
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
  "custom_tool",
  "checkpoint",
  "module_factory",
  "notify",
  "screenshot",
]);

const enabledGroups = new Set<string>();

export function enableGroup(name: string): { tools: string[]; error?: string } {
  if (name === "all") {
    for (const g of Object.keys(TOOL_GROUPS)) enabledGroups.add(g);
    return { tools: Object.values(TOOL_GROUPS).flat() };
  }
  const tools = TOOL_GROUPS[name];
  if (tools) {
    enabledGroups.add(name);
    return { tools };
  }
  // Resolve tool name → parent group (e.g. "web_search" → "web")
  for (const [groupName, groupTools] of Object.entries(TOOL_GROUPS)) {
    if (groupTools.includes(name)) {
      enabledGroups.add(groupName);
      return { tools: groupTools };
    }
  }
  return {
    tools: [],
    error: `Unknown group or tool "${name}". Available groups: ${Object.keys(TOOL_GROUPS).join(", ")}, all`,
  };
}

export function getActiveToolNames(): Set<string> {
  const names = new Set(CORE_TOOL_NAMES);
  for (const group of enabledGroups) {
    for (const tool of TOOL_GROUPS[group] ?? []) names.add(tool);
  }
  return names;
}

/** All tool names that belong to a group or are core — used to identify custom tools. */
const KNOWN_TOOL_NAMES = new Set([
  ...CORE_TOOL_NAMES,
  ...Object.values(TOOL_GROUPS).flat(),
]);

// --- Plugin group registration ---

const customGroupNames = new Set<string>();

/** Register a tool group (or extend an existing one) from a plugin. */
export function registerCustomGroup(name: string, toolNames: string[], pattern?: RegExp): void {
  if (!TOOL_GROUPS[name]) {
    TOOL_GROUPS[name] = [];
    customGroupNames.add(name);
  }
  for (const t of toolNames) {
    if (!TOOL_GROUPS[name].includes(t)) {
      TOOL_GROUPS[name].push(t);
      KNOWN_TOOL_NAMES.add(t);
    }
  }
  if (pattern) {
    GROUP_SIGNALS[name] = pattern;
  }
}

/** Remove all plugin-registered groups and rebuild KNOWN_TOOL_NAMES. */
export function clearCustomGroups(): void {
  for (const name of customGroupNames) {
    delete TOOL_GROUPS[name];
    delete GROUP_SIGNALS[name];
  }
  customGroupNames.clear();
  rebuildKnownNames();
}

function rebuildKnownNames(): void {
  KNOWN_TOOL_NAMES.clear();
  for (const n of CORE_TOOL_NAMES) KNOWN_TOOL_NAMES.add(n);
  for (const tools of Object.values(TOOL_GROUPS)) {
    for (const t of tools) KNOWN_TOOL_NAMES.add(t);
  }
}

export function filterTools(tools: readonly Anthropic.Tool[]): Anthropic.Tool[] {
  const active = getActiveToolNames();
  // Include active built-in tools + any custom-registered tools (not in any group/core)
  const filtered = tools.filter((t) => active.has(t.name) || !KNOWN_TOOL_NAMES.has(t.name));
  // enable_tools is not in the tool list but must always be available — rebuild with current groups
  if (!filtered.some((t) => t.name === "enable_tools")) {
    filtered.push(buildEnableToolsTool());
  }
  return filtered;
}

export function resetGroups(): void {
  enabledGroups.clear();
}

export function getEnabledGroups(): string[] {
  return [...enabledGroups].sort();
}

const GROUP_SIGNALS: Record<string, RegExp> = {
  web: /\b(research|browse|internet|website|online|url|https?:|web.?search|look.up|fetch.*(from|api|endpoint|server)|download|api.?(call|request|endpoint|data)|compare\b.*\b(option|tool|framework|service|provider|solution|platform|approach)|pros?.and.cons|report.on|review.*(option|tool|alternative|approach)|summarize.*(finding|source|article|result)|competitive.analysis|benchmark|what.is.the.best|recommend|find.*(hotel|flight|restaurant|venue|product|service)|latest.*(news|trend|update|release)|how.much.does|price|pricing|current.*(rate|price|status|weather)|look.?into)/i,
  code: /\b(python|calculate|compute|plot|chart|graph|visualiz|analyz|csv|statistic|pandas|numpy|matplotlib|data.analysis|spreadsheet|budget|forecast|convert.*(unit|currency|format)|formula|regression|correlat|aggregate|pivot|histogram|notebook|jupyter)/i,
  management: /\b(plan|planning|tasks?|track|tracking|schedule|monitor|remember|remind|reminder|background|watcher?|milestone|deadline|organize|prioritize|checklist|roadmap|project.management|breakdown|to.?do.?list|action.items|itinerary|agenda|timeline|phase|step.by.step|brainstorm|meeting.notes|retrospective|sprint|alarm|notify.me|alert.me|every\s+\d+\s+(minute|hour|day)|knowledge|knowledge.?base|note.?taking|research.findings|decision.log|reference|bookmark)/i,
  advanced_editing: /\b(refactor|refactoring|rename|renaming|codebase|bulk|batch)/i,
};

/** Detect tool groups that should be auto-enabled based on prompt content. */
export function detectToolGroups(prompt: string): string[] {
  const groups: string[] = [];
  for (const [name, pattern] of Object.entries(GROUP_SIGNALS)) {
    if (pattern.test(prompt)) groups.push(name);
  }
  return groups;
}

const CORE_LIST = [...CORE_TOOL_NAMES]
  .filter((n) => n !== "enable_tools")
  .sort()
  .join(", ");

/** Build enable_tools with current group info (includes plugin groups). */
function buildEnableToolsTool(): Anthropic.Tool {
  const desc = Object.entries(TOOL_GROUPS)
    .map(([name, tools]) => `- ${name}: ${tools.join(", ")}`)
    .join("\n");
  return {
    name: "enable_tools",
    description:
      `Enable additional tool groups. Call this before using specialized tools.\n\nGroups:\n${desc}\n- all: enable everything\n\nYou can also pass tool names (e.g. "web_search") — the parent group will be enabled.\n\nCore (always available): ${CORE_LIST}`,
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
}

/** For backwards compat — static reference rebuilt lazily. */
export const enableToolsTool: Anthropic.Tool = buildEnableToolsTool();

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
