import { Buffer } from "node:buffer";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageStreamParams } from "#core/model/model-client.js";
import type {
  SecurityLogExporter,
  SecurityLogRecord,
} from "./security-logs.js";

export class CapturingSecurityLogExporter implements SecurityLogExporter {
  readonly records: SecurityLogRecord[] = [];

  async export(records: readonly SecurityLogRecord[]): Promise<void> {
    this.records.push(...records);
  }
}

export type LoggedError = {
  msg: string;
  err: Error;
};

export type ProviderExchange = {
  requestBody: string;
  authorizationHeader: string;
  responseBody: string;
  error: Error;
};

export const sentinels = {
  prompt: "PROMPT_SENTINEL_20260701_DO_NOT_EXPORT",
  toolSchema: "TOOL_SCHEMA_SENTINEL_20260701_DO_NOT_EXPORT",
  toolResult: "TOOL_RESULT_SENTINEL_20260701_DO_NOT_EXPORT",
  reasoning: "REASONING_BLOCK_SENTINEL_20260701_DO_NOT_EXPORT",
  apiKey: "sk-proj-FAKE_API_KEY_SENTINEL_20260701",
  bearer: "Bearer FAKE_BEARER_TOKEN_SENTINEL_20260701",
  response: "MODEL_RESPONSE_SENTINEL_20260701_DO_NOT_EXPORT",
} as const;

export const forbiddenValues = Object.values(sentinels);

export function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `kota-provider-payload-leak-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function bytes(value: string): number {
  return Buffer.byteLength(value, "utf-8");
}

export function serializeLoggedErrors(errors: readonly LoggedError[]): string {
  return JSON.stringify(
    errors.map((entry) => ({
      msg: entry.msg,
      errorName: entry.err.name,
      errorMessage: entry.err.message,
    })),
  );
}

export async function flushAsyncCatchHandlers(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

export function providerErrorResponseBody(): string {
  return JSON.stringify({
    error: {
      message: `${sentinels.response} ${sentinels.bearer}`,
    },
  });
}

export function providerPayloadStreamParams(): MessageStreamParams {
  return {
    model: "openrouter/safe-metadata-model",
    max_tokens: 321,
    system: `system prompt ${sentinels.prompt}`,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: `user prompt ${sentinels.prompt}` }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: `reasoning-looking assistant text ${sentinels.reasoning}`,
          },
          {
            type: "tool_use",
            id: "call-provider-payload",
            name: "lookup_secret",
            input: { query: sentinels.toolResult },
          },
          {
            type: "thinking",
            thinking: sentinels.reasoning,
            signature: "fake-signature",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call-provider-payload",
            content: `tool result ${sentinels.toolResult} ${sentinels.bearer}`,
            structuredContent: { secretResult: sentinels.toolResult },
          },
        ],
      },
    ],
    tools: [
      {
        name: "lookup_secret",
        description: `tool schema ${sentinels.toolSchema}`,
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string", description: sentinels.toolSchema },
          },
          required: ["query"],
        },
      },
    ],
  };
}

export function writeProviderPayloadArtifacts(
  projectDir: string,
  runDir: string,
  exchange: ProviderExchange,
): void {
  const stepsDir = join(projectDir, runDir, "steps");
  mkdirSync(stepsDir, { recursive: true });
  writeFileSync(
    join(stepsDir, "build.json"),
    JSON.stringify({
      id: "build",
      type: "agent",
      status: "failed" as const,
      output: {
        sessionId: "session-provider-payload",
        turns: 4,
        totalCostUsd: 0.019,
        inputTokens: 987,
        outputTokens: 65,
        providerRequestBody: JSON.parse(exchange.requestBody),
        providerResponseBody: exchange.responseBody,
        providerAuthorizationHeader: exchange.authorizationHeader,
        modelClientError: exchange.error.message,
      },
    }),
  );
  writeFileSync(
    join(stepsDir, "build.tool-telemetry.json"),
    JSON.stringify({
      calls: [
        {
          toolUseId: "provider-call-1",
          tool: "model_provider.openai_compatible",
          inputBytes: bytes(exchange.requestBody),
          incomplete: false,
          truncated: false,
          durationMs: 321,
          success: false,
          resultBytes: bytes(exchange.responseBody),
          resultContentKind: "text",
        },
      ],
    }),
  );
}

export function writeBrokenEnrichmentArtifacts(
  projectDir: string,
  runDir: string,
): void {
  const stepsDir = join(projectDir, runDir, "steps");
  mkdirSync(stepsDir, { recursive: true });
  writeFileSync(
    join(stepsDir, "build.json"),
    `{ "rawProviderPayload": "${sentinels.prompt}",`,
  );
  writeFileSync(
    join(stepsDir, "build.tool-telemetry.json"),
    `{ "rawProviderPayload": "${sentinels.toolResult}",`,
  );
}
