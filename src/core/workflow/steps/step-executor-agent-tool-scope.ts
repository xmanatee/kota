import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import { getToolEffect } from "#core/tools/index.js";

function includeAskOwnerTool(
  allowedTools: string[] | undefined,
  askOwnerToolName: string | null,
): string[] | undefined {
  if (!allowedTools) return undefined;
  if (askOwnerToolName === null) return allowedTools;
  if (allowedTools.includes(askOwnerToolName)) return allowedTools;
  return [...allowedTools, askOwnerToolName];
}

function excludeAskOwnerTool(
  disallowedTools: string[] | undefined,
  askOwnerToolName: string | null,
): string[] | undefined {
  if (!disallowedTools || askOwnerToolName === null) return disallowedTools;
  return disallowedTools.filter((tool) => tool !== askOwnerToolName);
}

const PASSIVE_ALLOWED_TOOLS = [
  "Read",
  "LS",
  "Grep",
  "Glob",
  "NotebookRead",
  "WebFetch",
  "WebSearch",
  "TodoRead",
  "ListMcpResourcesTool",
  "ReadMcpResourceTool",
] as const;

const PASSIVE_ALLOWED_TOOL_SET = new Set<string>(PASSIVE_ALLOWED_TOOLS);

function isPassiveAllowedTool(tool: string, askOwnerToolName: string | null): boolean {
  if (tool === askOwnerToolName) return true;
  if (PASSIVE_ALLOWED_TOOL_SET.has(tool)) return true;
  return getToolEffect(tool)?.kind === "read";
}

function resolvePassiveAllowedTools(
  allowedTools: string[] | undefined,
  disallowedTools: string[] | undefined,
  askOwnerToolName: string | null,
): string[] {
  const requested = allowedTools ?? [...PASSIVE_ALLOWED_TOOLS];
  const unsafe = requested.filter((tool) => !isPassiveAllowedTool(tool, askOwnerToolName));
  if (unsafe.length > 0) {
    throw new Error(
      `Passive agent steps may only allow read-only tools; disallowed here: ${unsafe.join(", ")}`,
    );
  }
  const disallowed = new Set(excludeAskOwnerTool(disallowedTools, askOwnerToolName) ?? []);
  return includeAskOwnerTool(
    requested.filter((tool) => !disallowed.has(tool)),
    askOwnerToolName,
  ) as string[];
}

export function resolveAgentToolScope(
  mode: AutonomyMode,
  allowedTools: string[] | undefined,
  disallowedTools: string[] | undefined,
  askOwnerToolName: string | null,
): {
  allowedTools: string[] | undefined;
  disallowedTools: string[] | undefined;
} {
  if (mode === "autonomous") {
    return {
      allowedTools: includeAskOwnerTool(allowedTools, askOwnerToolName),
      disallowedTools: excludeAskOwnerTool(disallowedTools, askOwnerToolName),
    };
  }
  if (mode === "supervised") {
    throw new Error(
      "Workflow agent steps cannot use supervised autonomyMode because tool calls cannot be routed through KOTA approvals",
    );
  }
  return {
    allowedTools: resolvePassiveAllowedTools(allowedTools, disallowedTools, askOwnerToolName),
    disallowedTools: undefined,
  };
}
