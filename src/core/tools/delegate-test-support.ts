import { vi } from "vitest";
import type {
  KotaContentBlock,
  KotaMessageStream,
  KotaModelResponse,
  KotaTool,
} from "#core/agent-harness/message-protocol.js";
import type { MessageStreamParams, ModelClient } from "#core/model/model-client.js";

export class TestStream implements KotaMessageStream {
  constructor(private readonly response: KotaModelResponse) {}

  on(_event: "text" | "thinking", _cb: (delta: string) => void): this {
    return this;
  }

  async finalMessage(): Promise<KotaModelResponse> {
    return this.response;
  }
}

export function modelResponse(content: KotaContentBlock[]): KotaModelResponse {
  return {
    id: "msg_delegate",
    role: "assistant",
    model: "test-model",
    content,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

export function modelClient(
  stream: (params: MessageStreamParams) => KotaMessageStream,
): ModelClient {
  return {
    messages: {
      stream,
      create: vi.fn(async () => modelResponse([{ type: "text", text: "unused" }])),
    },
  };
}

export function testTool(name: string): KotaTool {
  return {
    name,
    description: `Test tool: ${name}`,
    input_schema: { type: "object" as const, properties: {} },
  };
}
