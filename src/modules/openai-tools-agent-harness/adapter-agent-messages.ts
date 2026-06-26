import type {
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
  KotaAgentMessage,
  KotaMessageStream,
  KotaToolResultBlock,
} from "#core/agent-harness/index.js";
import type { ValidatedToolUseBlock } from "./tool-loop.js";

export type AgentMessageEmitter = {
  emit(message: KotaAgentMessage): void;
  flush(): Promise<void>;
};

export function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const reason = signal.reason;
    throw reason instanceof Error ? reason : new Error("Agent execution aborted");
  }
}

export function createAgentMessageEmitter(
  onMessage: AgentHarnessRunOptions["onMessage"],
): AgentMessageEmitter {
  let chain = Promise.resolve();
  let failure: Error | undefined;
  return {
    emit(message) {
      if (onMessage === undefined) return;
      chain = chain
        .then(async () => {
          if (failure !== undefined) return;
          await onMessage(message);
        })
        .catch((error) => {
          failure ??= error instanceof Error ? error : new Error(String(error));
        });
    },
    async flush() {
      await chain;
      if (failure !== undefined) {
        throw failure;
      }
    },
  };
}

export function attachAgentMessageStreamEvents(
  stream: KotaMessageStream,
  writer: AgentHarnessWriter | undefined,
  streamedChunks: string[],
  agentMessages: AgentMessageEmitter,
): void {
  stream.on("text", (delta) => {
    streamedChunks.push(delta);
    agentMessages.emit({ type: "text", text: delta });
    if (writer) writer.write(delta);
  });
  stream.on("thinking", (delta) => {
    agentMessages.emit({ type: "thinking", thinking: delta });
  });
}

export function emitModelTurnStarted(
  agentMessages: AgentMessageEmitter,
  turn: number,
): void {
  agentMessages.emit({
    type: "status",
    category: "model_turn",
    description: `openai-tools turn ${turn + 1} started`,
  });
}

export function emitResultMessage(
  agentMessages: AgentMessageEmitter,
  result: AgentHarnessResult,
  sessionId: string | undefined,
): void {
  agentMessages.emit({
    type: "result",
    isError: result.isError,
    ...(result.text.length > 0 ? { text: result.text } : {}),
    ...(result.subtype !== undefined ? { subtype: result.subtype } : {}),
    ...(result.turns !== undefined ? { numTurns: result.turns } : {}),
    ...(result.inputTokens !== undefined ? { inputTokens: result.inputTokens } : {}),
    ...(result.outputTokens !== undefined
      ? { outputTokens: result.outputTokens }
      : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
  });
}

export function emitToolCallMessages(
  agentMessages: AgentMessageEmitter,
  toolBlocks: readonly ValidatedToolUseBlock[],
  sessionId: string | undefined,
): void {
  for (const block of toolBlocks) {
    agentMessages.emit({
      type: "tool_call",
      toolUseId: block.id,
      toolName: block.name,
      input: block.input,
      ...(sessionId !== undefined ? { sessionId } : {}),
    });
  }
}

export function emitToolResultMessages(
  agentMessages: AgentMessageEmitter,
  resultBlocks: readonly KotaToolResultBlock[],
  sessionId: string | undefined,
): void {
  for (const block of resultBlocks) {
    agentMessages.emit({
      type: "tool_result",
      toolUseId: block.tool_use_id,
      isError: block.is_error === true,
      content: toolResultBlockToAgentContent(block),
      ...(sessionId !== undefined ? { sessionId } : {}),
    });
  }
}

function toolResultBlockToAgentContent(
  block: KotaToolResultBlock,
): Extract<KotaAgentMessage, { type: "tool_result" }>["content"] {
  if (
    typeof block.content === "string" &&
    block.structuredContent === undefined &&
    block._meta === undefined
  ) {
    return block.content;
  }
  return [block];
}
