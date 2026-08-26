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
import type { LoopOptions } from "#core/loop/loop.js";
import {
  composeTranscriptPrompt,
  type ReplTurn,
} from "#modules/repl/index.js";
import { ConversationHistory } from "./history.js";
import { getScopeHistoryDir } from "./history-utils.js";

export type HarnessResumeRunOptions = Omit<AgentHarnessRunOptions, "prompt">;

export type HarnessConversationResumeOptions = {
  harness: AgentHarness;
  prompt: string;
  run: HarnessResumeRunOptions;
  conversation?: LoopOptions & { resumeConversation: string };
  writer?: AgentHarnessWriter;
};

export type HarnessResumeConversationStore = {
  transcript: ReplTurn[];
  appendUserInput(input: string): void;
  appendAssistantResult(result: AgentHarnessResult): void;
};

export function openHarnessResumeConversation(
  scopeRoot: string,
  conversationId: string,
): HarnessResumeConversationStore {
  const history = new ConversationHistory(getScopeHistoryDir(scopeRoot));
  const data = history.load(conversationId);
  if (!data) {
    throw new Error(`Conversation "${conversationId}" not found in ${scopeRoot}`);
  }
  const messages: KotaMessage[] = [...data.messages];
  const compactionCount = data.compactionCount;
  let lastInputTokens = data.lastInputTokens;

  function save(): void {
    history.save(conversationId, messages, compactionCount, lastInputTokens);
  }

  return {
    transcript: transcriptFromKotaMessages(messages),
    appendUserInput(input: string): void {
      messages.push({ role: "user", content: input });
      save();
    },
    appendAssistantResult(result: AgentHarnessResult): void {
      if (result.text) messages.push({ role: "assistant", content: result.text });
      if (result.usage.tokens.state !== "unknown") {
        lastInputTokens = result.usage.tokens.inputTokens;
      }
      save();
    },
  };
}

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

  const store = openHarnessResumeConversation(
    options.conversation.scopeRoot ?? process.cwd(),
    options.conversation.resumeConversation,
  );
  const composedPrompt = composeTranscriptPrompt(store.transcript, options.prompt);
  store.appendUserInput(options.prompt);
  const result = await runAgentHarness(
    options.harness,
    { ...options.run, prompt: composedPrompt },
    options.writer,
  );
  store.appendAssistantResult(result);
  return result;
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
