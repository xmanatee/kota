import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { KotaAgentMessage } from "#core/agent-harness/index.js";
import {
  hasToolResultTruncationMarker,
  measureTelemetryPayloadBytes,
  type ToolTelemetry,
  type ToolTelemetryResultContentKind,
} from "#core/tools/tool-telemetry.js";
import type { WorkflowRunMetadata } from "../run-types.js";

function getAgentToolResultContentKind(
  content: Extract<KotaAgentMessage, { type: "tool_result" }>["content"],
): ToolTelemetryResultContentKind {
  if (Array.isArray(content)) return "blocks";
  if (content.length === 0) return "empty";
  return "text";
}

export function makeToolTelemetryTracker(
  telemetry: ToolTelemetry,
  onMessage: (message: KotaAgentMessage) => void,
): (message: KotaAgentMessage) => void {
  const pending = new Map<string, { name: string; startMs: number }>();
  return (message: KotaAgentMessage) => {
    onMessage(message);
    if (message.type === "tool_call") {
      pending.set(message.toolUseId, {
        name: message.toolName,
        startMs: Date.now(),
      });
      telemetry.recordCallStart({
        toolUseId: message.toolUseId,
        tool: message.toolName,
        inputBytes: measureTelemetryPayloadBytes(message.input),
      });
      return;
    }
    if (message.type === "tool_result") {
      const entry = pending.get(message.toolUseId);
      if (!entry) return;
      const durationMs = Date.now() - entry.startMs;
      const errorMsg = message.isError
        ? (typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.content)
          ).slice(0, 200)
        : undefined;
      telemetry.recordCallResult({
        toolUseId: message.toolUseId,
        tool: entry.name,
        durationMs,
        success: !message.isError,
        resultBytes: measureTelemetryPayloadBytes(message.content),
        resultContentKind: getAgentToolResultContentKind(message.content),
        truncated: hasToolResultTruncationMarker(message.content),
        ...(errorMsg !== undefined ? { error: errorMsg } : {}),
      });
      pending.delete(message.toolUseId);
    }
  };
}

export function writeToolTelemetryArtifact(
  stepId: string,
  metadata: WorkflowRunMetadata,
  projectDir: string,
  telemetry: ToolTelemetry,
): void {
  const calls = telemetry.getCallRecords();
  const callsOmitted = telemetry.getOmittedCallCount();
  if (telemetry.getTotalCalls() === 0 && calls.length === 0 && callsOmitted === 0) return;
  const tools: Record<string, Record<string, unknown>> = {};
  for (const [name, s] of telemetry.getStats()) {
    const avgMs = s.calls > 0 ? Math.round(s.totalMs / s.calls) : 0;
    const entry: Record<string, unknown> = {
      calls: s.calls,
      successes: s.successes,
      failures: s.failures,
      totalMs: s.totalMs,
      avgMs,
    };
    if (s.lastError !== undefined) entry.lastError = s.lastError;
    tools[name] = entry;
  }
  const payload = {
    summary: telemetry.getSummary(),
    tools,
    calls,
    ...(callsOmitted > 0 ? { callsOmitted } : {}),
  };
  const filePath = join(resolve(projectDir, metadata.runDir), "steps", `${stepId}.tool-telemetry.json`);
  writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
}
