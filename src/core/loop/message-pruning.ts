import type {
  KotaMessage,
  KotaToolResultBlock,
  KotaToolUseBlock,
} from "#core/agent-harness/message-protocol.js";

type Message = KotaMessage;

/** Read-only tools whose results can safely be pruned (reproducible by re-running). */
const PRUNEABLE_TOOLS = new Set([
  "file_read",
  "grep",
  "glob",
  "repo_map",
  "web_fetch",
  "web_search",
  "delegate",
]);

const DEFAULT_KEEP_RECENT = 20;
const DEFAULT_MIN_LENGTH = 1500;

type ToolCallInfo = {
  name: string;
  input: Record<string, unknown>;
};

export type PruneStats = {
  prunedCount: number;
  charsSaved: number;
};

export type PruneOptions = {
  keepRecent?: number;
  minLength?: number;
};

/** Build a map of tool_use_id → { name, input } from assistant messages. */
export function buildToolCallMap(messages: Message[]): Map<string, ToolCallInfo> {
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

/** Generate a compact summary for a pruned tool result. */
export function generateSummary(
  toolName: string,
  input: Record<string, unknown>,
  content: string,
): string {
  const lineCount = content.split("\n").length;

  switch (toolName) {
    case "file_read": {
      const path = (input.path || input.file_path || "unknown") as string;
      return `[Previously read: ${path} — ${lineCount} lines. Re-read if needed.]`;
    }
    case "grep": {
      const pattern = (input.pattern || "") as string;
      return `[Previous grep for "${pattern.slice(0, 50)}" — ~${lineCount} lines. Re-grep if needed.]`;
    }
    case "glob": {
      const pattern = (input.pattern || "") as string;
      return `[Previous glob "${pattern.slice(0, 50)}" — ${lineCount} results. Re-glob if needed.]`;
    }
    case "repo_map":
      return `[Previous repo map — ${lineCount} lines. Re-run if needed.]`;
    case "web_fetch": {
      const url = (input.url || "") as string;
      return `[Previously fetched: ${url.slice(0, 80)}. Re-fetch if needed.]`;
    }
    case "web_search": {
      const query = (input.query || "") as string;
      return `[Previous search: "${query.slice(0, 50)}". Re-search if needed.]`;
    }
    case "delegate": {
      const task = (input.task || "") as string;
      return `[Previous delegate: "${task.slice(0, 60)}". Result pruned.]`;
    }
    default:
      return `[Previous ${toolName} — ${lineCount} lines. Re-run if needed.]`;
  }
}

/**
 * Prune large read-only tool results from older messages.
 *
 * Only prunes results that are:
 * - From read-only tools (file_read, grep, glob, repo_map, web_fetch, web_search, delegate)
 * - Older than `keepRecent` messages from the end
 * - Larger than `minLength` characters
 * - Not error results
 *
 * Replaces content with a compact summary so the agent knows what was there.
 * Mutates messages in place (matches compaction's approach).
 */
export function pruneMessages(messages: Message[], options?: PruneOptions): PruneStats {
  const keepRecent = options?.keepRecent ?? DEFAULT_KEEP_RECENT;
  const minLength = options?.minLength ?? DEFAULT_MIN_LENGTH;

  if (messages.length <= keepRecent) {
    return { prunedCount: 0, charsSaved: 0 };
  }

  const toolCallMap = buildToolCallMap(messages);
  const pruneableEnd = messages.length - keepRecent;
  let prunedCount = 0;
  let charsSaved = 0;

  for (let i = 0; i < pruneableEnd; i++) {
    const msg = messages[i];
    if (msg.role !== "user" || typeof msg.content === "string") continue;
    if (!Array.isArray(msg.content)) continue;

    for (const block of msg.content) {
      if (block.type !== "tool_result") continue;
      const tr = block as KotaToolResultBlock;

      if (tr.is_error) continue;

      // Image-bearing results (array content with image blocks) — always prune
      const hasImages = Array.isArray(tr.content) &&
        (tr.content as Array<{ type: string }>).some((b) => b.type === "image");

      if (hasImages) {
        const toolInfo = toolCallMap.get(tr.tool_use_id);
        const path = toolInfo ? (toolInfo.input.path || toolInfo.input.file_path || "image") as string : "image";
        const summary = `[Previously viewed image: ${path}. Re-read if needed.]`;
        const estimatedSaved = 5000; // Images consume ~1000+ tokens; estimate char savings
        (tr as { content: string }).content = summary;
        prunedCount++;
        charsSaved += estimatedSaved;
        continue;
      }

      // Extract text from string or array-of-text-blocks content
      const textContent = typeof tr.content === "string"
        ? tr.content
        : Array.isArray(tr.content)
          ? (tr.content as Array<{ type: string; text?: string }>)
              .filter((b) => b.type === "text")
              .map((b) => b.text || "")
              .join("\n")
          : "";

      if (textContent.length < minLength) continue;

      const toolInfo = toolCallMap.get(tr.tool_use_id);
      if (!toolInfo || !PRUNEABLE_TOOLS.has(toolInfo.name)) continue;

      const summary = generateSummary(toolInfo.name, toolInfo.input, textContent);
      const saved = textContent.length - summary.length;

      (tr as { content: string }).content = summary;
      prunedCount++;
      charsSaved += saved;
    }
  }

  return { prunedCount, charsSaved };
}
