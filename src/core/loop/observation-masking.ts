import type { KotaMessage } from "#core/agent-harness/message-protocol.js";
import {
  buildToolCallMap,
  extractToolResultText,
  formatMaskedToolObservation,
  hasToolResultImageContent,
  isMaskedToolObservation,
  MASKED_OBSERVATION_PREFIX,
} from "./tool-observations.js";

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

export type MaskStats = {
  maskedCount: number;
  charsSaved: number;
};

/** Generate a compact placeholder for a masked tool observation. */
export const generatePlaceholder = formatMaskedToolObservation;

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
      const tr = block;

      if (isMaskedToolObservation(tr)) continue;

      // Handle image content — always mask (images are expensive)
      if (hasToolResultImageContent(tr)) {
        const toolInfo = toolCallMap.get(tr.tool_use_id);
        const placeholder = toolInfo
          ? formatMaskedToolObservation(toolInfo.name, toolInfo.input, !!tr.is_error)
          : `${MASKED_OBSERVATION_PREFIX} image]`;
        tr.content = placeholder;
        maskedCount++;
        charsSaved += 5000; // Estimate for image tokens
        continue;
      }

      const text = extractToolResultText(tr);
      if (text.length < MIN_CONTENT_LENGTH) continue;

      const toolInfo = toolCallMap.get(tr.tool_use_id);
      const placeholder = toolInfo
        ? formatMaskedToolObservation(toolInfo.name, toolInfo.input, !!tr.is_error)
        : `${MASKED_OBSERVATION_PREFIX} tool result]`;

      const saved = text.length - placeholder.length;
      if (saved <= 0) continue;

      tr.content = placeholder;
      maskedCount++;
      charsSaved += saved;
    }
  }

  return { maskedCount, charsSaved };
}
