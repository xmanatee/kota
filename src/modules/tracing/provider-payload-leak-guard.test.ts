import { trace } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OpenAIModelClient } from "#modules/model-clients/openai/client.js";
import {
  bytes,
  CapturingSecurityLogExporter,
  flushAsyncCatchHandlers,
  forbiddenValues,
  headersToRecord,
  type LoggedError,
  makeTmpDir,
  type ProviderExchange,
  providerErrorResponseBody,
  providerPayloadStreamParams,
  sentinels,
  serializeLoggedErrors,
  writeBrokenEnrichmentArtifacts,
  writeProviderPayloadArtifacts,
} from "./provider-payload-leak-guard-test-support.js";
import {
  OtlpHttpSecurityLogExporter,
  SecurityLogEmitter,
} from "./security-logs.js";
import { WorkflowTracer } from "./tracer.js";

function expectForbiddenValuesAbsent(payload: string): void {
  for (const value of forbiddenValues) {
    expect(payload).not.toContain(value);
  }
}

async function captureProviderExchange(): Promise<ProviderExchange> {
  const responseBody = providerErrorResponseBody();
  let requestBody = "";
  let authorizationHeader = "";

  globalThis.fetch = async (
    _input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    requestBody = String(init?.body ?? "");
    const headers = headersToRecord(init?.headers);
    authorizationHeader = headers.Authorization ?? headers.authorization ?? "";
    return new Response(responseBody, { status: 502 });
  };

  const client = new OpenAIModelClient({
    baseUrl: "https://provider.example/v1",
    apiKey: sentinels.apiKey,
    presetName: "test",
  });
  const stream = client.messages.stream(providerPayloadStreamParams());

  let error: Error | undefined;
  try {
    await stream.finalMessage();
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
  }
  if (!error) throw new Error("Expected provider request to fail");

  return { requestBody, authorizationHeader, responseBody, error };
}

describe("provider payload observability leak guard", () => {
  let originalFetch: typeof globalThis.fetch;
  let spanExporter: InMemorySpanExporter;
  let provider: NodeTracerProvider;
  let projectDir: string;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    trace.disable();
    spanExporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      resource: resourceFromAttributes({ "service.name": "kota-test" }),
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    provider.register();
    projectDir = makeTmpDir();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await provider.shutdown();
    trace.disable();
  });

  it("omits raw model-provider request, response, tool, reasoning, and credential values from exported observability payloads", async () => {
    const exchange = await captureProviderExchange();
    const runDir = ".kota/runs/provider-payload-leak-guard";
    writeProviderPayloadArtifacts(projectDir, runDir, exchange);

    expect(exchange.requestBody).toContain(sentinels.prompt);
    expect(exchange.requestBody).toContain(sentinels.toolSchema);
    expect(exchange.requestBody).toContain(sentinels.toolResult);
    expect(exchange.requestBody).toContain(sentinels.reasoning);
    expect(exchange.requestBody).toContain(sentinels.bearer);
    expect(exchange.authorizationHeader).toContain(sentinels.apiKey);
    expect(exchange.responseBody).toContain(sentinels.response);
    expect(exchange.responseBody).toContain(sentinels.bearer);
    expect(exchange.error.message).toContain("OpenAI API error 502");
    expect(exchange.error.message).toContain(
      `provider response body omitted (${bytes(exchange.responseBody)} bytes)`,
    );
    expectForbiddenValuesAbsent(exchange.error.message);

    const tracerErrors: LoggedError[] = [];
    const tracer = new WorkflowTracer(
      projectDir,
      new Map([["provider-payload-leak-guard:build", "openrouter/safe-metadata-model"]]),
      (msg, err) => {
        tracerErrors.push({
          msg,
          err: err instanceof Error ? err : new Error(String(err)),
        });
      },
    );
    tracer.onWorkflowStarted({
      workflow: "provider-payload-leak-guard",
      runId: "run-provider-payload-leak",
      triggerEvent: "test",
      runDir,
      startedAt: "2026-07-01T14:00:00.000Z",
      autonomyMode: "autonomous",
    });
    tracer.onStepStarted({
      workflow: "provider-payload-leak-guard",
      runId: "run-provider-payload-leak",
      stepId: "build",
      stepType: "agent",
      startedAt: "2026-07-01T14:00:01.000Z",
      autonomyMode: "autonomous",
    });
    const completedPayload = {
      projectId: "project-provider-payload",
      workflow: "provider-payload-leak-guard",
      runId: "run-provider-payload-leak",
      stepId: "build",
      stepType: "agent" as const,
      status: "failed" as const,
      durationMs: 4567,
      costUsd: 0.031,
      runDir,
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      autonomyMode: "autonomous" as const,
    };
    tracer.onStepCompleted(completedPayload);
    tracer.onWorkflowCompleted({
      workflow: "provider-payload-leak-guard",
      runId: "run-provider-payload-leak",
      status: "failed",
      durationMs: 5000,
      triggerEvent: "test",
      tags: ["safety"],
      autonomyMode: "autonomous",
    });

    const securityExporter = new CapturingSecurityLogExporter();
    const securityErrors: LoggedError[] = [];
    const securityEmitter = new SecurityLogEmitter(
      projectDir,
      securityExporter,
      (msg, err) => securityErrors.push({ msg, err }),
    );
    securityEmitter.onStepCompleted(completedPayload);

    const otlpBodies: string[] = [];
    const otlpExporter = new OtlpHttpSecurityLogExporter(
      "http://otel.example/v1/logs",
      "kota-test",
      async (_url, init) => {
        otlpBodies.push(init.body);
        return { ok: true, status: 200, text: async () => "" };
      },
    );
    await otlpExporter.export(securityExporter.records);

    const brokenRunDir = ".kota/runs/provider-payload-leak-guard-broken";
    writeBrokenEnrichmentArtifacts(projectDir, brokenRunDir);
    const brokenPayload = {
      ...completedPayload,
      runId: "run-provider-payload-broken",
      runDir: brokenRunDir,
    };
    const brokenTracer = new WorkflowTracer(projectDir, new Map(), (msg, err) => {
      tracerErrors.push({
        msg,
        err: err instanceof Error ? err : new Error(String(err)),
      });
    });
    brokenTracer.onWorkflowStarted({
      workflow: "provider-payload-leak-guard",
      runId: "run-provider-payload-broken",
      triggerEvent: "test",
      runDir: brokenRunDir,
      startedAt: "2026-07-01T14:01:00.000Z",
    });
    brokenTracer.onStepStarted({
      workflow: "provider-payload-leak-guard",
      runId: "run-provider-payload-broken",
      stepId: "build",
      stepType: "agent",
      startedAt: "2026-07-01T14:01:01.000Z",
    });
    brokenTracer.onStepCompleted(brokenPayload);
    securityEmitter.onStepCompleted(brokenPayload);

    const exportErrors: LoggedError[] = [];
    const failingOtlpExporter = new OtlpHttpSecurityLogExporter(
      "http://otel.example/v1/logs",
      "kota-test",
      async () => ({
        ok: false,
        status: 500,
        text: async () => `collector echo ${exchange.requestBody} ${exchange.responseBody}`,
      }),
    );
    const failingEmitter = new SecurityLogEmitter(
      projectDir,
      failingOtlpExporter,
      (msg, err) => exportErrors.push({ msg, err }),
    );
    failingEmitter.onGuardrailAssessed({
      tool: "model_provider.openai_compatible",
      risk: "dangerous",
      policy: "queue",
      reason: exchange.requestBody,
      session: "session-provider-payload",
    });
    await flushAsyncCatchHandlers();

    const spans = spanExporter.getFinishedSpans().map((span) => ({
      name: span.name,
      status: span.status,
      attributes: span.attributes,
    }));
    const agentSpan = spans.find((span) => span.name === "step.agent");
    expect(agentSpan?.attributes).toMatchObject({
      "workflow.step.model": "openrouter/safe-metadata-model",
      "workflow.step.status": "failed",
      "workflow.step.duration_ms": 4567,
      "workflow.step.cost_usd": 0.031,
      "workflow.step.turns": 4,
      "workflow.step.total_cost_usd": 0.019,
      "workflow.step.input_tokens": 987,
      "workflow.step.output_tokens": 65,
      autonomy_mode: "autonomous",
    });

    const toolCall = securityExporter.records.find((record) => record.name === "agent.tool_call");
    expect(toolCall?.severityText).toBe("WARN");
    expect(toolCall?.attributes).toMatchObject({
      "project.id": "project-provider-payload",
      "workflow.name": "provider-payload-leak-guard",
      "workflow.step.status": "failed",
      "workflow.step.duration_ms": 4567,
      "session.id": "session-provider-payload",
      "tool.name": "model_provider.openai_compatible",
      "tool.input_bytes": bytes(exchange.requestBody),
      "tool.input_omitted": true,
      "tool.result_bytes": bytes(exchange.responseBody),
      "tool.result_omitted": true,
      "tool.success": false,
      "tool.duration_ms": 321,
      "tool.result_content_kind": "text",
    });
    expect(otlpBodies.join("\n")).toContain("tool.input_bytes");
    expect(otlpBodies.join("\n")).toContain("tool.result_omitted");
    expect(tracerErrors).toHaveLength(1);
    expect(securityErrors).toHaveLength(1);
    expect(exportErrors).toHaveLength(1);
    expect(exportErrors[0]!.err.message).toContain("response body omitted");
    expect(exportErrors[0]!.err.message).toContain("bytes");

    const exportedObservabilityPayload = JSON.stringify({
      modelClientError: exchange.error.message,
      spans,
      securityRecords: securityExporter.records,
      securityLogOtlpBodies: otlpBodies,
      enrichmentLoggerCalls: [
        serializeLoggedErrors(tracerErrors),
        serializeLoggedErrors(securityErrors),
      ],
      exportLoggerCalls: serializeLoggedErrors(exportErrors),
    });
    expectForbiddenValuesAbsent(exportedObservabilityPayload);
  });
});
