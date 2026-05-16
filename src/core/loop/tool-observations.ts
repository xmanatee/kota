import type {
  KotaMessage,
  KotaToolResultBlock,
  KotaToolUseBlock,
} from "#core/agent-harness/message-protocol.js";

export const MASKED_OBSERVATION_PREFIX = "[Observed:";

type ToolInputValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ToolInputValue[]
  | { readonly [key: string]: ToolInputValue };

type ToolInputObject = { readonly [key: string]: ToolInputValue };

export type ToolCallInfo = {
  name: string;
  input: KotaToolUseBlock["input"];
};

function isToolInputObject(
  input: KotaToolUseBlock["input"],
): input is ToolInputObject {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function inputString(
  input: KotaToolUseBlock["input"],
  keys: readonly string[],
  fallback: string,
): string {
  if (!isToolInputObject(input)) {
    throw new TypeError("Tool observation input must be an object");
  }
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
  }
  return fallback;
}

export function buildToolCallMap(
  messages: readonly KotaMessage[],
): Map<string, ToolCallInfo> {
  const map = new Map<string, ToolCallInfo>();
  for (const msg of messages) {
    if (msg.role !== "assistant" || typeof msg.content === "string") continue;
    for (const block of msg.content) {
      if (block.type !== "tool_use") continue;
      map.set(block.id, { name: block.name, input: block.input });
    }
  }
  return map;
}

export function extractToolResultText(result: KotaToolResultBlock): string {
  if (typeof result.content === "string") return result.content;
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function hasToolResultImageContent(result: KotaToolResultBlock): boolean {
  return (
    Array.isArray(result.content) &&
    result.content.some((block) => block.type === "image")
  );
}

export function isMaskedToolObservation(result: KotaToolResultBlock): boolean {
  return extractToolResultText(result).startsWith(MASKED_OBSERVATION_PREFIX);
}

export function formatPrunedImageObservation(toolInfo: ToolCallInfo | undefined): string {
  const path = toolInfo
    ? inputString(toolInfo.input, ["path", "file_path"], "image")
    : "image";
  return `[Previously viewed image: ${path}. Re-read if needed.]`;
}

export function formatPrunedToolObservation(
  toolName: string,
  input: KotaToolUseBlock["input"],
  content: string,
): string {
  const lineCount = content.split("\n").length;

  switch (toolName) {
    case "file_read": {
      const path = inputString(input, ["path", "file_path"], "unknown");
      return `[Previously read: ${path} — ${lineCount} lines. Re-read if needed.]`;
    }
    case "grep": {
      const pattern = inputString(input, ["pattern"], "");
      return `[Previous grep for "${pattern.slice(0, 50)}" — ~${lineCount} lines. Re-grep if needed.]`;
    }
    case "glob": {
      const pattern = inputString(input, ["pattern"], "");
      return `[Previous glob "${pattern.slice(0, 50)}" — ${lineCount} results. Re-glob if needed.]`;
    }
    case "repo_map":
      return `[Previous repo map — ${lineCount} lines. Re-run if needed.]`;
    case "web_fetch": {
      const url = inputString(input, ["url"], "");
      return `[Previously fetched: ${url.slice(0, 80)}. Re-fetch if needed.]`;
    }
    case "web_search": {
      const query = inputString(input, ["query"], "");
      return `[Previous search: "${query.slice(0, 50)}". Re-search if needed.]`;
    }
    case "delegate": {
      const task = inputString(input, ["task"], "");
      return `[Previous delegate: "${task.slice(0, 60)}". Result pruned.]`;
    }
    default:
      return `[Previous ${toolName} — ${lineCount} lines. Re-run if needed.]`;
  }
}

export function formatMaskedToolObservation(
  toolName: string,
  input: KotaToolUseBlock["input"],
  isError: boolean,
): string {
  const status = isError ? " (error)" : "";

  switch (toolName) {
    case "file_read": {
      const path = inputString(input, ["path", "file_path"], "?");
      return `${MASKED_OBSERVATION_PREFIX} read ${path}${status}]`;
    }
    case "file_edit":
    case "multi_edit":
    case "find_replace": {
      const path = inputString(input, ["file_path", "path"], "?");
      return `${MASKED_OBSERVATION_PREFIX} edited ${path}${status}]`;
    }
    case "file_write": {
      const path = inputString(input, ["file_path", "path"], "?");
      return `${MASKED_OBSERVATION_PREFIX} wrote ${path}${status}]`;
    }
    case "shell": {
      const cmd = inputString(input, ["command"], "?");
      return `${MASKED_OBSERVATION_PREFIX} shell: ${cmd.slice(0, 80)}${status}]`;
    }
    case "process": {
      const action = inputString(input, ["action"], "?");
      const cmd = inputString(input, ["command"], "");
      const label = cmd ? `${action} ${cmd.slice(0, 60)}` : action;
      return `${MASKED_OBSERVATION_PREFIX} process: ${label}${status}]`;
    }
    case "code_exec": {
      const lang = inputString(input, ["language"], "code");
      return `${MASKED_OBSERVATION_PREFIX} executed ${lang}${status}]`;
    }
    case "grep": {
      const pattern = inputString(input, ["pattern"], "?");
      return `${MASKED_OBSERVATION_PREFIX} grep "${pattern.slice(0, 50)}"${status}]`;
    }
    case "glob": {
      const pattern = inputString(input, ["pattern"], "?");
      return `${MASKED_OBSERVATION_PREFIX} glob "${pattern.slice(0, 50)}"${status}]`;
    }
    case "repo_map":
      return `${MASKED_OBSERVATION_PREFIX} repo map${status}]`;
    case "web_search": {
      const query = inputString(input, ["query"], "?");
      return `${MASKED_OBSERVATION_PREFIX} search "${query.slice(0, 50)}"${status}]`;
    }
    case "web_fetch": {
      const url = inputString(input, ["url"], "?");
      return `${MASKED_OBSERVATION_PREFIX} fetched ${url.slice(0, 80)}${status}]`;
    }
    case "delegate": {
      const task = inputString(input, ["task"], "?");
      return `${MASKED_OBSERVATION_PREFIX} delegate: "${task.slice(0, 60)}"${status}]`;
    }
    case "todo":
      return `${MASKED_OBSERVATION_PREFIX} todo${status}]`;
    case "files_overview":
      return `${MASKED_OBSERVATION_PREFIX} files overview${status}]`;
    case "notebook":
      return `${MASKED_OBSERVATION_PREFIX} notebook${status}]`;
    case "http_request": {
      const method = inputString(input, ["method"], "GET");
      const url = inputString(input, ["url"], "?");
      return `${MASKED_OBSERVATION_PREFIX} ${method} ${url.slice(0, 60)}${status}]`;
    }
    case "memory": {
      const action = inputString(input, ["action"], "?");
      return `${MASKED_OBSERVATION_PREFIX} memory ${action}${status}]`;
    }
    case "schedule": {
      const action = inputString(input, ["action"], "?");
      return `${MASKED_OBSERVATION_PREFIX} schedule ${action}${status}]`;
    }
    case "ask_user":
      return `${MASKED_OBSERVATION_PREFIX} asked user${status}]`;
    case "enable_tools":
      return `${MASKED_OBSERVATION_PREFIX} enabled tools${status}]`;
    case "get_secret":
      return `${MASKED_OBSERVATION_PREFIX} got secret${status}]`;
    case "custom_tool":
      return `${MASKED_OBSERVATION_PREFIX} custom tool${status}]`;
    case "screenshot":
      return `${MASKED_OBSERVATION_PREFIX} screenshot${status}]`;
    default:
      return `${MASKED_OBSERVATION_PREFIX} ${toolName}${status}]`;
  }
}

export function formatToolCallLogLabel(toolName: string): string {
  return `[tool: ${toolName}]`;
}
