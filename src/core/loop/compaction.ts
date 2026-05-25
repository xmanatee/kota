import type {
  KotaContentBlock,
  KotaMessage,
  KotaTextBlock,
  KotaThinkingBlock,
  KotaToolResultBlock,
  KotaToolUseBlock,
} from "#core/agent-harness/message-protocol.js";
import type { ModelClient } from "#core/model/model-client.js";

type Message = KotaMessage;
type ContentBlock = KotaContentBlock;
type AssistantRationaleEntry =
  | { kind: "thinking"; block: KotaThinkingBlock; text: string }
  | { kind: "compacted"; message: Message; itemIndex: number; text: string };

const MAX_STRING_MESSAGE_CHARS = 800;
const MAX_TEXT_BLOCK_CHARS = 400;
const MAX_TOOL_INPUT_CHARS = 120;
const MAX_TOOL_RESULT_CHARS = 120;
const MAX_TOOL_RESULT_TEXT_BLOCK_CHARS = 80;
const MAX_THINKING_BLOCK_CHARS = 700;
const MAX_THINKING_BLOCKS = 6;

type WorkingState = {
  filesModified: string[];
  commandsRun: string[];
  errors: string[];
  toolCalls: number;
};

/**
 * Deterministically extract structured state from conversation messages.
 * Preserves exact facts that an LLM summary would lose.
 */
export function extractWorkingState(messages: Message[]): WorkingState {
  const fileSet = new Set<string>();
  const commandsRun: string[] = [];
  const errors: string[] = [];
  let toolCalls = 0;

  for (const msg of messages) {
    if (typeof msg.content === "string") continue;
    if (!Array.isArray(msg.content)) continue;

    for (const block of msg.content as ContentBlock[]) {
      if (block.type === "tool_use") {
        toolCalls++;
        const tu = block as KotaToolUseBlock;
        const input = tu.input as Record<string, unknown>;
        const name = tu.name;

        if (name === "file_edit" || name === "file_write") {
          const path = (input.file_path || input.path) as string | undefined;
          if (path) fileSet.add(path);
        } else if (name === "multi_edit") {
          const edits = input.edits as Array<{ file_path?: string }> | undefined;
          if (edits) {
            for (const e of edits) {
              if (e.file_path) fileSet.add(e.file_path);
            }
          }
        } else if (name === "shell") {
          const cmd = input.command as string | undefined;
          if (cmd) commandsRun.push(cmd.length > 120 ? `${cmd.slice(0, 120)}...` : cmd);
        } else if (name === "process" && input.action === "start") {
          const cmd = input.command as string | undefined;
          if (cmd) commandsRun.push(`[bg] ${cmd.length > 115 ? `${cmd.slice(0, 115)}...` : cmd}`);
        }
      }

      if (block.type === "tool_result") {
        const tr = block as KotaToolResultBlock;
        if (tr.is_error && typeof tr.content === "string") {
          errors.push(tr.content.length > 200 ? `${tr.content.slice(0, 200)}...` : tr.content);
        }
      }
    }
  }

  return {
    filesModified: [...fileSet],
    commandsRun: [...new Set(commandsRun)].slice(-15),
    errors: errors.slice(-5),
    toolCalls,
  };
}

/** Format extracted state as a concise text block. */
function formatState(state: WorkingState): string {
  const parts: string[] = [];

  if (state.filesModified.length > 0) {
    parts.push(`Files modified: ${state.filesModified.join(", ")}`);
  }
  if (state.commandsRun.length > 0) {
    parts.push(`Commands run: ${state.commandsRun.join("; ")}`);
  }
  if (state.errors.length > 0) {
    parts.push(`Errors hit:\n${state.errors.map((e) => `  - ${e}`).join("\n")}`);
  }
  parts.push(`Total tool calls: ${state.toolCalls}`);
  return parts.join("\n");
}

function truncateForCompaction(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}... [truncated]`;
}

function formatToolInput(input: KotaToolUseBlock["input"]): string {
  const serialized = JSON.stringify(input);
  return typeof serialized === "string" ? serialized : String(serialized);
}

function formatThinkingBlock(block: KotaThinkingBlock): string | null {
  const thinking = block.thinking.trim();
  if (!thinking) return null;
  return truncateForCompaction(thinking, MAX_THINKING_BLOCK_CHARS);
}

function extractSection(content: string, heading: string): string | null {
  const marker = `### ${heading}\n`;
  const start = content.indexOf(marker);
  if (start === -1) return null;

  const bodyStart = start + marker.length;
  const rest = content.slice(bodyStart);
  const nextHeading = rest.search(/\n### /);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  const trimmed = section.trim();
  return trimmed || null;
}

function extractCompactedAssistantRationaleItems(content: string): string[] {
  if (!content.startsWith("[Context compaction #")) return [];

  const section = extractSection(content, "Assistant rationale");
  if (!section) return [];

  const items: string[] = [];
  let current: string[] = [];

  for (const line of section.split("\n")) {
    const numbered = line.match(/^\d+\.\s+(.*)$/);
    if (numbered) {
      if (current.length > 0) items.push(current.join("\n").trim());
      current = [numbered[1] ?? ""];
      continue;
    }

    if (current.length > 0) {
      current.push(line);
    } else if (line.trim()) {
      current = [line.trim()];
    }
  }

  if (current.length > 0) items.push(current.join("\n").trim());

  return items
    .filter(Boolean)
    .map((item) => truncateForCompaction(item, MAX_THINKING_BLOCK_CHARS));
}

function collectAssistantRationaleEntries(messages: Message[]): AssistantRationaleEntry[] {
  const entries: AssistantRationaleEntry[] = [];

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      const compactedItems = extractCompactedAssistantRationaleItems(msg.content);
      compactedItems.forEach((text, itemIndex) => {
        entries.push({ kind: "compacted", message: msg, itemIndex, text });
      });
      continue;
    }

    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;

    for (const block of msg.content as ContentBlock[]) {
      if (block.type !== "thinking") continue;
      const formatted = formatThinkingBlock(block);
      if (formatted) entries.push({ kind: "thinking", block, text: formatted });
    }
  }

  return entries.slice(-MAX_THINKING_BLOCKS);
}

function selectAssistantRationale(messages: Message[]): {
  entries: string[];
  compactedItemsByMessage: Map<Message, Set<number>>;
  thinkingBlocks: Set<KotaThinkingBlock>;
} {
  const selectedEntries = collectAssistantRationaleEntries(messages);
  const compactedItemsByMessage = new Map<Message, Set<number>>();
  const thinkingBlocks = new Set<KotaThinkingBlock>();

  for (const entry of selectedEntries) {
    if (entry.kind === "thinking") {
      thinkingBlocks.add(entry.block);
      continue;
    }

    let selectedItems = compactedItemsByMessage.get(entry.message);
    if (!selectedItems) {
      selectedItems = new Set<number>();
      compactedItemsByMessage.set(entry.message, selectedItems);
    }
    selectedItems.add(entry.itemIndex);
  }

  return {
    entries: selectedEntries.map((entry) => entry.text),
    compactedItemsByMessage,
    thinkingBlocks,
  };
}

function formatAssistantRationale(entries: string[]): string {
  return entries
    .map((rationale, index) => `${index + 1}. ${rationale}`)
    .join("\n");
}

function extractThinkingSignatures(messages: Message[]): string[] {
  const signatures = new Set<string>();

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    if (!Array.isArray(msg.content)) continue;

    for (const block of msg.content as ContentBlock[]) {
      if (block.type !== "thinking") continue;
      const signature = block.signature.trim();
      if (signature) signatures.add(signature);
    }
  }

  return [...signatures];
}

function redactThinkingSignatures(text: string, signatures: string[]): string {
  let redacted = text;
  for (const signature of signatures) {
    redacted = redacted.split(signature).join("[redacted thinking signature]");
  }
  return redacted;
}

/**
 * Build a richer conversation representation for the summarizer.
 * Extracts meaningful content from tool_use and tool_result blocks
 * instead of just showing "(structured content)".
 */
function buildConversationText(
  messages: Message[],
  selectedRationale: ReturnType<typeof selectAssistantRationale>,
): string {
  const lines: string[] = [];

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      const parts = [truncateForCompaction(msg.content, MAX_STRING_MESSAGE_CHARS)];
      const selectedCompactedItems = selectedRationale.compactedItemsByMessage.get(msg);
      if (selectedCompactedItems) {
        const rationale = extractCompactedAssistantRationaleItems(msg.content)
          .filter((_, itemIndex) => selectedCompactedItems.has(itemIndex));
        if (rationale.length > 0) {
          parts.push(
            `[compacted assistant rationale] ${rationale
              .map((item, index) => `${index + 1}. ${item}`)
              .join("\n")}`,
          );
        }
      }
      lines.push(`[${msg.role}]: ${parts.join("\n")}`);
      continue;
    }
    if (!Array.isArray(msg.content)) continue;

    const parts: string[] = [];
    for (const block of msg.content as ContentBlock[]) {
      if (block.type === "text") {
        parts.push(truncateForCompaction((block as KotaTextBlock).text, MAX_TEXT_BLOCK_CHARS));
      } else if (block.type === "thinking") {
        const thinkingBlock = block as KotaThinkingBlock;
        if (!selectedRationale.thinkingBlocks.has(thinkingBlock)) continue;
        const thinking = formatThinkingBlock(thinkingBlock);
        if (thinking) parts.push(`[assistant thinking/rationale] ${thinking}`);
      } else if (block.type === "tool_use") {
        const tu = block as KotaToolUseBlock;
        parts.push(`${tu.name}(${truncateForCompaction(formatToolInput(tu.input), MAX_TOOL_INPUT_CHARS)})`);
      } else if (block.type === "tool_result") {
        const tr = block as KotaToolResultBlock;
        const status = tr.is_error ? "ERR" : "OK";
        let preview: string;
        if (typeof tr.content === "string") {
          preview = truncateForCompaction(tr.content, MAX_TOOL_RESULT_CHARS);
        } else if (Array.isArray(tr.content)) {
          const hasImage = tr.content.some((b) => b.type === "image");
          const textPart = tr.content.find((b) => b.type === "text");
          const textPreview =
            textPart && "text" in textPart
              ? truncateForCompaction(textPart.text, MAX_TOOL_RESULT_TEXT_BLOCK_CHARS)
              : "";
          preview = hasImage ? `[image] ${textPreview}` : textPreview || "(structured)";
        } else {
          preview = "(structured)";
        }
        parts.push(`[${status}] ${preview}`);
      }
    }
    if (parts.length > 0) {
      lines.push(`[${msg.role}]: ${parts.join(" | ")}`);
    }
  }

  return lines.join("\n");
}

export const COMPACTION_PROMPT =
  "Summarize this conversation concisely. Preserve:\n" +
  "1. The user's goal and any sub-goals\n" +
  "2. Key decisions made and their rationale\n" +
  "3. Current progress (what's done, what's in progress, what remains)\n" +
  "4. Important constraints or gotchas discovered\n" +
  "Be brief but preserve details needed to continue the work seamlessly.";

/**
 * Build the compacted context: deterministic structured state + LLM narrative summary.
 * Returns the full replacement message content.
 */
export async function compactMessages(
  client: ModelClient,
  model: string,
  messages: Message[],
  compactionNumber: number,
): Promise<Message[]> {
  const state = extractWorkingState(messages);
  const stateText = formatState(state);
  const selectedRationale = selectAssistantRationale(messages);
  const conversationText = buildConversationText(messages, selectedRationale);
  const assistantRationale = formatAssistantRationale(selectedRationale.entries);
  const thinkingSignatures = extractThinkingSignatures(messages);

  let narrativeSummary: string;
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: COMPACTION_PROMPT,
      messages: [{ role: "user", content: conversationText }],
    });
    narrativeSummary =
      response.content[0].type === "text" ? response.content[0].text : "Summary unavailable";
  } catch {
    narrativeSummary = conversationText.slice(0, 1500);
  }
  narrativeSummary = redactThinkingSignatures(narrativeSummary, thinkingSignatures);

  const compactedContent =
    `[Context compaction #${compactionNumber}]\n\n` +
    `### Working state\n${stateText}\n\n` +
    (assistantRationale ? `### Assistant rationale\n${assistantRationale}\n\n` : "") +
    `### Summary\n${narrativeSummary}`;

  return [
    { role: "user", content: compactedContent },
    { role: "assistant", content: "Understood. I have the full context. Continuing." },
  ];
}
