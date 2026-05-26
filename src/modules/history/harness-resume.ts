import {
  type AgentHarness,
  type AgentHarnessResult,
  type AgentHarnessRunOptions,
  type AgentHarnessWriter,
  runAgentHarness,
} from "#core/agent-harness/index.js";
import type {
  KotaContentBlock,
  KotaMessage,
  KotaToolResultBlockContent,
  KotaToolResultContentBlock,
} from "#core/agent-harness/message-protocol.js";
import { AgentSession, type LoopOptions } from "#core/loop/loop.js";
import {
  composeTranscriptPrompt,
  type ReplTurn,
} from "#modules/repl/index.js";

export type HarnessResumeRunOptions = Omit<AgentHarnessRunOptions, "prompt">;

export type HarnessConversationResumeOptions = {
  harness: AgentHarness;
  prompt: string;
  run: HarnessResumeRunOptions;
  conversation?: LoopOptions & { resumeConversation: string };
  writer?: AgentHarnessWriter;
};

export async function runAgentHarnessWithConversationResume(
  options: HarnessConversationResumeOptions,
): Promise<AgentHarnessResult> {
  if (!options.conversation) {
    return runAgentHarness(
      options.harness,
      { ...options.run, prompt: options.prompt },
      options.writer,
    );
  }

  const session = new AgentSession(options.conversation);
  let errored = false;
  try {
    await session.initPromise;
    const transcript = transcriptFromKotaMessages(session.context.getMessages());
    const composedPrompt = composeTranscriptPrompt(transcript, options.prompt);
    session.context.addUserMessage(options.prompt);
    const result = await runAgentHarness(
      options.harness,
      { ...options.run, prompt: composedPrompt },
      options.writer,
    );
    if (result.text) session.context.addAssistantText(result.text);
    if (typeof result.inputTokens === "number") {
      session.context.setInputTokens(result.inputTokens);
    }
    errored = result.isError;
    return result;
  } catch (err) {
    errored = true;
    throw err;
  } finally {
    session.close(errored);
  }
}

export function transcriptFromKotaMessages(messages: KotaMessage[]): ReplTurn[] {
  const turns: ReplTurn[] = [];
  let pendingUser: string | undefined;

  for (const message of messages) {
    const text = renderMessageContent(message);
    if (!text) continue;
    if (message.role === "user") {
      if (pendingUser !== undefined) {
        turns.push({ user: pendingUser, assistant: "" });
      }
      pendingUser = text;
      continue;
    }
    if (pendingUser === undefined) {
      turns.push({ user: "", assistant: text });
      continue;
    }
    turns.push({ user: pendingUser, assistant: text });
    pendingUser = undefined;
  }

  if (pendingUser !== undefined) turns.push({ user: pendingUser, assistant: "" });
  return turns;
}

function renderMessageContent(message: KotaMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content.map(renderContentBlock).filter(Boolean).join("\n");
}

function renderContentBlock(block: KotaContentBlock): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "tool_use":
      return `[tool_use ${block.name}] ${JSON.stringify(block.input)}`;
    case "tool_result":
      return `[tool_result ${block.tool_use_id}] ${renderToolResultContent(block.content)}`;
    case "image":
      return "[image]";
    case "thinking":
      return "[assistant thinking omitted]";
  }
}

function renderToolResultContent(content: KotaToolResultBlockContent): string {
  if (typeof content === "string") return content;
  return content.map(renderToolResultContentBlock).filter(Boolean).join("\n");
}

function renderToolResultContentBlock(block: KotaToolResultContentBlock): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "image":
      return "[image]";
    case "mcp_content":
      return `[mcp_content ${block.content.type}]`;
  }
}
