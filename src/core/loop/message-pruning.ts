import type { KotaMessage } from "#core/agent-harness/message-protocol.js";
import {
  buildToolCallMap,
  extractToolResultText,
  formatPrunedImageObservation,
  formatPrunedToolObservation,
  hasToolResultImageContent,
} from "./tool-observations.js";

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

export type PruneStats = {
  prunedCount: number;
  charsSaved: number;
};

export type PruneOptions = {
  keepRecent?: number;
  minLength?: number;
};

export { buildToolCallMap } from "./tool-observations.js";

/** Generate a compact summary for a pruned tool result. */
export const generateSummary = formatPrunedToolObservation;

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
      const tr = block;

      if (tr.is_error) continue;

      // Image-bearing results (array content with image blocks) — always prune
      if (hasToolResultImageContent(tr)) {
        const toolInfo = toolCallMap.get(tr.tool_use_id);
        const summary = formatPrunedImageObservation(toolInfo);
        const estimatedSaved = 5000; // Images consume ~1000+ tokens; estimate char savings
        tr.content = summary;
        prunedCount++;
        charsSaved += estimatedSaved;
        continue;
      }

      // Extract text from string or array-of-text-blocks content
      const textContent = extractToolResultText(tr);

      if (textContent.length < minLength) continue;

      const toolInfo = toolCallMap.get(tr.tool_use_id);
      if (!toolInfo || !PRUNEABLE_TOOLS.has(toolInfo.name)) continue;

      const summary = formatPrunedToolObservation(toolInfo.name, toolInfo.input, textContent);
      const saved = textContent.length - summary.length;

      tr.content = summary;
      prunedCount++;
      charsSaved += saved;
    }
  }

  return { prunedCount, charsSaved };
}
