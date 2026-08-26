import type { KotaAgentMessage } from "#core/agent-harness/types.js";
import { pricedAgentUsage } from "#core/agent-harness/usage.js";

type ToolCallInput = Extract<KotaAgentMessage, { type: "tool_call" }>["input"];
type ToolResultContent = string | object[];

export type RawSdkContentBlock = {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: ToolCallInput;
  tool_use_id?: string;
  is_error?: boolean;
  content?: ToolResultContent;
};

export type RawSdkMessage = {
  type: string;
  subtype?: string;
  session_id?: string;
  sessionId?: string;
  message?: { content?: RawSdkContentBlock[] } | string;
  content?: RawSdkContentBlock[];
  description?: string;
  output?: string[];
  tool_name?: string;
  result?: string;
  total_cost_usd?: number;
  num_turns?: number;
  is_error?: boolean;
  usage?: { input_tokens: number; output_tokens: number };
};

function extractTextBlocks(blocks?: RawSdkContentBlock[]): string {
  if (!blocks) return "";
  const out: string[] = [];
  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string") {
      out.push(block.text);
    }
  }
  return out.join("");
}

function extractMessageContent(message: RawSdkMessage): RawSdkContentBlock[] {
  if (Array.isArray(message.content)) return message.content;
  const nestedMessage = message.message;
  if (
    nestedMessage &&
    typeof nestedMessage === "object" &&
    Array.isArray(nestedMessage.content)
  ) {
    return nestedMessage.content;
  }
  return [];
}

function isToolInput(value: ToolCallInput | undefined): value is ToolCallInput {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractText(message: RawSdkMessage): string {
  return extractTextBlocks(extractMessageContent(message));
}

export function getSessionId(message: RawSdkMessage): string | undefined {
  return message.session_id ?? message.sessionId;
}

export function extractStatusText(message: RawSdkMessage): string | null {
  if (
    message.type === "auth_status" &&
    Array.isArray(message.output) &&
    message.output.length > 0
  ) {
    return message.output.join(" ").trim();
  }
  if (typeof message.description === "string" && message.description) {
    return message.description;
  }
  if (typeof message.tool_name === "string" && message.tool_name) {
    return `${message.tool_name} running`;
  }
  if (typeof message.message === "string" && message.message) {
    return message.message;
  }
  const text = extractText(message);
  return text || null;
}

export function toKotaAgentMessages(message: RawSdkMessage): KotaAgentMessage[] {
  const sessionId = getSessionId(message);
  const withSession = <T extends KotaAgentMessage>(value: T): T =>
    sessionId !== undefined ? { ...value, sessionId } : value;

  if (message.type === "assistant") {
    const blocks = extractMessageContent(message);
    const out: KotaAgentMessage[] = [];
    for (const block of blocks) {
      if (block.type === "text" && typeof block.text === "string") {
        out.push(withSession({ type: "text", text: block.text }));
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        out.push(withSession({ type: "thinking", thinking: block.thinking }));
      } else if (
        block.type === "tool_use" &&
        typeof block.id === "string" &&
        typeof block.name === "string"
      ) {
        const input = isToolInput(block.input) ? block.input : {};
        out.push(
          withSession({
            type: "tool_call",
            toolUseId: block.id,
            toolName: block.name,
            input,
          }),
        );
      }
    }
    return out;
  }

  if (message.type === "user") {
    const blocks = extractMessageContent(message);
    const out: KotaAgentMessage[] = [];
    for (const block of blocks) {
      if (
        block.type === "tool_result" &&
        typeof block.tool_use_id === "string"
      ) {
        const rawContent = block.content;
        const content =
          typeof rawContent === "string"
            ? rawContent
            : Array.isArray(rawContent)
              ? JSON.stringify(rawContent)
              : "";
        out.push(
          withSession({
            type: "tool_result",
            toolUseId: block.tool_use_id,
            isError: block.is_error === true,
            content,
          }),
        );
      }
    }
    return out;
  }

  if (message.type === "result") {
    const text = typeof message.result === "string" ? message.result : undefined;
    return [
      withSession({
        type: "result",
        isError:
          message.is_error === true ||
          Boolean(message.subtype?.startsWith("error_")),
        ...(text !== undefined ? { text } : {}),
        ...(message.subtype !== undefined ? { subtype: message.subtype } : {}),
        ...(message.num_turns !== undefined ? { numTurns: message.num_turns } : {}),
        usage: pricedAgentUsage(
          message.usage?.input_tokens,
          message.usage?.output_tokens,
          message.total_cost_usd,
        ),
      }),
    ];
  }

  const text = extractStatusText(message);
  return [
    withSession({
      type: "status",
      category: message.type,
      ...(message.subtype !== undefined ? { description: message.subtype } : {}),
      ...(message.tool_name !== undefined ? { toolName: message.tool_name } : {}),
      ...(message.output !== undefined ? { output: message.output } : {}),
      ...(text !== null ? { text } : {}),
    }),
  ];
}
