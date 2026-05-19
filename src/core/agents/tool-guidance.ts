import type { KotaTool } from "#core/agent-harness/message-protocol.js";

const MAX_DESCRIPTION_CHARS = 260;
const MAX_INPUTS = 12;

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 3).trimEnd()}...`;
}

function formatInputs(tool: KotaTool): string {
  const names = Object.keys(tool.input_schema.properties);
  if (names.length === 0) return "";
  const required = new Set(tool.input_schema.required ?? []);
  const visible = names.slice(0, MAX_INPUTS).map((name) =>
    required.has(name) ? `${name}*` : name
  );
  if (names.length > MAX_INPUTS) visible.push("...");
  return ` Inputs: ${visible.join(", ")}.`;
}

function uniqueTools(tools: readonly KotaTool[]): KotaTool[] {
  const byName = new Map<string, KotaTool>();
  for (const tool of tools) {
    if (!byName.has(tool.name)) byName.set(tool.name, tool);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function descriptionFor(tool: KotaTool): string {
  if (tool.name === "enable_tools") {
    return "Enable additional tool groups contributed by loaded modules. Use this only when the task needs a capability that is not already admitted.";
  }
  return tool.description;
}

/**
 * Format a concise per-turn capability summary from the actual resolved tool
 * definitions admitted to the current session. This intentionally has no
 * hand-maintained capability catalog: names, descriptions, and input fields
 * come from the owning tool definitions after module loading and tool-policy
 * filtering.
 */
export function formatResolvedToolGuidance(tools: readonly KotaTool[]): string {
  const resolved = uniqueTools(tools);
  if (resolved.length === 0) return "";

  const lines = resolved.map((tool) => {
    const description = truncate(compact(descriptionFor(tool)), MAX_DESCRIPTION_CHARS);
    return `- ${tool.name}: ${description}${formatInputs(tool)}`;
  });

  return [
    "",
    "<available-tools>",
    "Generated from the resolved tools admitted to this turn. Treat this as the source of truth for available tool capabilities; if a tool is absent here, do not claim it is available.",
    ...lines,
    "</available-tools>",
    "",
  ].join("\n");
}

export function formatResolvedToolNameGuidance(toolNames: readonly string[]): string {
  const names = [...new Set(toolNames)].sort();
  if (names.length === 0) return "";
  return [
    "",
    "<available-tools>",
    "Generated from the resolved native harness tool allow-list for this sub-agent. Use the harness tool schemas as the source of truth.",
    ...names.map((name) => `- ${name}`),
    "</available-tools>",
    "",
  ].join("\n");
}
