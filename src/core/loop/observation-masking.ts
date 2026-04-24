import type {
  KotaMessage,
  KotaToolResultBlock,
  KotaToolUseBlock,
} from "#core/agent-harness/message-protocol.js";

type Message = KotaMessage;

/**
 * Observation masking: replace old tool outputs with compact placeholders.
 *
 * Based on JetBrains research (NeurIPS 2025, "The Complexity Trap"):
 * tool outputs are 80%+ of context tokens. Replacing outputs beyond a
 * rolling window with placeholders cuts context ~50% with no performance
 * loss. The agent's reasoning and actions are preserved — only raw
 * observations are masked.
 *
 * Unlike the older message-pruning approach, this:
 * - Runs every turn (zero LLM cost, pure string replacement)
 * - Masks ALL tool outputs, not just read-only tools
 * - Uses a tighter window (10 messages vs 20)
 */

const DEFAULT_WINDOW = 10;
const MIN_CONTENT_LENGTH = 200;

/** Sentinel prefix so we never re-mask an already-masked result. */
const MASKED_PREFIX = "[Observed:";

export type MaskStats = {
  maskedCount: number;
  charsSaved: number;
};

type ToolCallInfo = {
  name: string;
  input: Record<string, unknown>;
};

/** Build a map of tool_use_id → { name, input } from assistant messages. */
function buildToolCallMap(messages: Message[]): Map<string, ToolCallInfo> {
  const map = new Map<string, ToolCallInfo>();
  for (const msg of messages) {
    if (msg.role !== "assistant" || typeof msg.content === "string") continue;
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type === "tool_use") {
        const tu = block as KotaToolUseBlock;
        map.set(tu.id, {
          name: tu.name,
          input: tu.input as Record<string, unknown>,
        });
      }
    }
  }
  return map;
}

/** Generate a compact placeholder for a masked tool observation. */
export function generatePlaceholder(
  toolName: string,
  input: Record<string, unknown>,
  isError: boolean,
): string {
  const status = isError ? " (error)" : "";

  switch (toolName) {
    case "file_read": {
      const path = (input.path || input.file_path || "?") as string;
      return `${MASKED_PREFIX} read ${path}${status}]`;
    }
    case "file_edit":
    case "multi_edit":
    case "find_replace": {
      const path = (input.file_path || input.path || "?") as string;
      return `${MASKED_PREFIX} edited ${path}${status}]`;
    }
    case "file_write": {
      const path = (input.file_path || input.path || "?") as string;
      return `${MASKED_PREFIX} wrote ${path}${status}]`;
    }
    case "shell": {
      const cmd = (input.command || "?") as string;
      return `${MASKED_PREFIX} shell: ${cmd.slice(0, 80)}${status}]`;
    }
    case "process": {
      const action = (input.action || "?") as string;
      const cmd = (input.command || "") as string;
      const label = cmd ? `${action} ${cmd.slice(0, 60)}` : action;
      return `${MASKED_PREFIX} process: ${label}${status}]`;
    }
    case "code_exec": {
      const lang = (input.language || "code") as string;
      return `${MASKED_PREFIX} executed ${lang}${status}]`;
    }
    case "grep": {
      const pattern = (input.pattern || "?") as string;
      return `${MASKED_PREFIX} grep "${pattern.slice(0, 50)}"${status}]`;
    }
    case "glob": {
      const pattern = (input.pattern || "?") as string;
      return `${MASKED_PREFIX} glob "${pattern.slice(0, 50)}"${status}]`;
    }
    case "repo_map":
      return `${MASKED_PREFIX} repo map${status}]`;
    case "web_search": {
      const query = (input.query || "?") as string;
      return `${MASKED_PREFIX} search "${query.slice(0, 50)}"${status}]`;
    }
    case "web_fetch": {
      const url = (input.url || "?") as string;
      return `${MASKED_PREFIX} fetched ${url.slice(0, 80)}${status}]`;
    }
    case "delegate": {
      const task = (input.task || "?") as string;
      return `${MASKED_PREFIX} delegate: "${task.slice(0, 60)}"${status}]`;
    }
    case "todo":
      return `${MASKED_PREFIX} todo${status}]`;
    case "files_overview":
      return `${MASKED_PREFIX} files overview${status}]`;
    case "notebook":
      return `${MASKED_PREFIX} notebook${status}]`;
    case "http_request": {
      const method = (input.method || "GET") as string;
      const url = (input.url || "?") as string;
      return `${MASKED_PREFIX} ${method} ${url.slice(0, 60)}${status}]`;
    }
    case "memory": {
      const action = (input.action || "?") as string;
      return `${MASKED_PREFIX} memory ${action}${status}]`;
    }
    case "schedule": {
      const action = (input.action || "?") as string;
      return `${MASKED_PREFIX} schedule ${action}${status}]`;
    }
    case "ask_user":
      return `${MASKED_PREFIX} asked user${status}]`;
    case "enable_tools":
      return `${MASKED_PREFIX} enabled tools${status}]`;
    case "get_secret":
      return `${MASKED_PREFIX} got secret${status}]`;
    case "custom_tool":
      return `${MASKED_PREFIX} custom tool${status}]`;
    case "screenshot":
      return `${MASKED_PREFIX} screenshot${status}]`;
    default:
      return `${MASKED_PREFIX} ${toolName}${status}]`;
  }
}

/** Extract text content from a tool_result block. */
function extractText(tr: KotaToolResultBlock): string {
  if (typeof tr.content === "string") return tr.content;
  if (Array.isArray(tr.content)) {
    return (tr.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text || "")
      .join("\n");
  }
  return "";
}

/** Check if content is already masked. */
function isAlreadyMasked(tr: KotaToolResultBlock): boolean {
  const text = typeof tr.content === "string" ? tr.content : extractText(tr);
  return text.startsWith(MASKED_PREFIX);
}

/** Check if content contains an image block. */
function hasImageContent(tr: KotaToolResultBlock): boolean {
  return (
    Array.isArray(tr.content) &&
    (tr.content as Array<{ type: string }>).some((b) => b.type === "image")
  );
}

/**
 * Mask old tool observations beyond a rolling window.
 *
 * Replaces tool_result content with compact placeholders for all messages
 * older than `windowSize` from the end. Preserves reasoning and action
 * history (assistant text + tool_use blocks are untouched).
 *
 * Mutates messages in place. Idempotent — already-masked results are skipped.
 */
export function maskObservations(
  messages: Message[],
  windowSize = DEFAULT_WINDOW,
): MaskStats {
  if (messages.length <= windowSize) {
    return { maskedCount: 0, charsSaved: 0 };
  }

  const toolCallMap = buildToolCallMap(messages);
  const maskableEnd = messages.length - windowSize;
  let maskedCount = 0;
  let charsSaved = 0;

  for (let i = 0; i < maskableEnd; i++) {
    const msg = messages[i];
    if (msg.role !== "user" || typeof msg.content === "string") continue;
    if (!Array.isArray(msg.content)) continue;

    for (const block of msg.content) {
      if (block.type !== "tool_result") continue;
      const tr = block as KotaToolResultBlock;

      if (isAlreadyMasked(tr)) continue;

      // Handle image content — always mask (images are expensive)
      if (hasImageContent(tr)) {
        const toolInfo = toolCallMap.get(tr.tool_use_id);
        const placeholder = toolInfo
          ? generatePlaceholder(toolInfo.name, toolInfo.input, !!tr.is_error)
          : `${MASKED_PREFIX} image]`;
        (tr as { content: string }).content = placeholder;
        maskedCount++;
        charsSaved += 5000; // Estimate for image tokens
        continue;
      }

      const text = extractText(tr);
      if (text.length < MIN_CONTENT_LENGTH) continue;

      const toolInfo = toolCallMap.get(tr.tool_use_id);
      const placeholder = toolInfo
        ? generatePlaceholder(toolInfo.name, toolInfo.input, !!tr.is_error)
        : `${MASKED_PREFIX} tool result]`;

      const saved = text.length - placeholder.length;
      if (saved <= 0) continue;

      (tr as { content: string }).content = placeholder;
      maskedCount++;
      charsSaved += saved;
    }
  }

  return { maskedCount, charsSaved };
}
