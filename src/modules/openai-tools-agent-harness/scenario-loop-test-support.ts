import { join } from "node:path";
import type {
  KotaMessage,
  KotaModelResponse,
  KotaTool,
} from "#core/agent-harness/message-protocol.js";

export const SHIPPED_SCENARIOS_ROOT = join(
  import.meta.dirname,
  "..",
  "harness-parity",
  "scenarios",
);

export const FILE_READ_TOOL: KotaTool = {
  name: "file_read",
  description: "Read a file from the working directory",
  input_schema: {
    type: "object" as const,
    properties: { path: { type: "string" } },
    required: ["path"],
  },
};

export const FILE_WRITE_TOOL: KotaTool = {
  name: "file_write",
  description: "Write a file to the working directory",
  input_schema: {
    type: "object" as const,
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
};

export const SHELL_TOOL: KotaTool = {
  name: "shell",
  description: "Run a shell command in the working directory",
  input_schema: {
    type: "object" as const,
    properties: { command: { type: "string" } },
    required: ["command"],
  },
};

type StubFinalMessage = Pick<
  KotaModelResponse,
  "id" | "content" | "stop_reason"
> & {
  usage?: { input_tokens: number; output_tokens: number };
};

export type StubStream = {
  on(event: "text" | "thinking", cb: (delta: string) => void): StubStream;
  finalMessage(): Promise<KotaModelResponse>;
};

export function makeStubStream(opts: {
  textChunks?: string[];
  final: StubFinalMessage;
}): StubStream {
  const stream: StubStream = {
    on(event, cb) {
      if (event === "text" && opts.textChunks) {
        for (const chunk of opts.textChunks) cb(chunk);
      }
      return stream;
    },
    finalMessage: async (): Promise<KotaModelResponse> => ({
      id: opts.final.id,
      role: "assistant",
      model: "stub-model",
      content: opts.final.content,
      stop_reason: opts.final.stop_reason ?? "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: opts.final.usage?.input_tokens ?? 0,
        output_tokens: opts.final.usage?.output_tokens ?? 0,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      },
    }),
  };
  return stream;
}

export function concatToolResultContent(messages: KotaMessage[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role !== "user" || typeof message.content === "string") continue;
    for (const block of message.content) {
      if (block.type !== "tool_result") continue;
      const content = block.content;
      if (typeof content === "string") {
        parts.push(content);
        continue;
      }
      if (!Array.isArray(content)) continue;
      for (const inner of content) {
        if (inner.type === "text" && typeof inner.text === "string") {
          parts.push(inner.text);
        }
      }
    }
  }
  return parts.join("\n");
}

export const EXPECTED_PATTERN = /must return exactly "([^"]+)"/;

export function extractExpectedFromToolResult(messages: KotaMessage[]): string {
  const blob = concatToolResultContent(messages);
  const match = EXPECTED_PATTERN.exec(blob);
  if (!match) {
    throw new Error(
      "stubbed revise turn could not find expected value in prior tool_result content - " +
        "adapter may have dropped tool_result.content bytes. Blob was:\n" +
        (blob.length > 0 ? blob : "<empty>"),
    );
  }
  return match[1];
}
