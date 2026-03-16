import type Anthropic from "@anthropic-ai/sdk";

type Message = Anthropic.MessageParam;
type ContentBlock = Anthropic.Messages.ContentBlockParam;

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
        const input = (block as Anthropic.Messages.ToolUseBlockParam).input as Record<
          string,
          unknown
        >;
        const name = (block as Anthropic.Messages.ToolUseBlockParam).name;

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
        const tr = block as Anthropic.Messages.ToolResultBlockParam;
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

/**
 * Build a richer conversation representation for the summarizer.
 * Extracts meaningful content from tool_use and tool_result blocks
 * instead of just showing "(structured content)".
 */
function buildConversationText(messages: Message[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      lines.push(`[${msg.role}]: ${msg.content.slice(0, 800)}`);
      continue;
    }
    if (!Array.isArray(msg.content)) continue;

    const parts: string[] = [];
    for (const block of msg.content as ContentBlock[]) {
      if (block.type === "text") {
        parts.push((block as Anthropic.Messages.TextBlockParam).text.slice(0, 400));
      } else if (block.type === "tool_use") {
        const tu = block as Anthropic.Messages.ToolUseBlockParam;
        parts.push(`${tu.name}(${JSON.stringify(tu.input).slice(0, 120)})`);
      } else if (block.type === "tool_result") {
        const tr = block as Anthropic.Messages.ToolResultBlockParam;
        const status = tr.is_error ? "ERR" : "OK";
        let preview: string;
        if (typeof tr.content === "string") {
          preview = tr.content.slice(0, 120);
        } else if (Array.isArray(tr.content)) {
          const hasImage = tr.content.some((b) => b.type === "image");
          const textPart = tr.content.find((b) => b.type === "text");
          const textPreview = textPart && "text" in textPart ? (textPart.text as string).slice(0, 80) : "";
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
  client: Anthropic,
  model: string,
  messages: Message[],
  compactionNumber: number,
): Promise<Message[]> {
  const state = extractWorkingState(messages);
  const stateText = formatState(state);
  const conversationText = buildConversationText(messages);

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

  const compactedContent =
    `[Context compaction #${compactionNumber}]\n\n` +
    `### Working state\n${stateText}\n\n` +
    `### Summary\n${narrativeSummary}`;

  return [
    { role: "user", content: compactedContent },
    { role: "assistant", content: "Understood. I have the full context. Continuing." },
  ];
}
