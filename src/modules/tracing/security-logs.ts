import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BusEvents } from "#core/events/event-bus-types.js";
import type { ModuleEventProxy } from "#core/modules/module-types.js";
import {
  measureTelemetryPayloadBytes,
  type ToolTelemetryCallRecord,
} from "#core/tools/tool-telemetry.js";
import {
  type InjectionDefenseAssessedPayload,
  injectionDefenseAssessed,
} from "#modules/injection-defense/events.js";
import type { TracingConfig } from "./config-slice.js";

const LOGGER_NAME = "kota-security";
const DEFAULT_SERVICE_NAME = "kota";

export type SecurityLogAttributeValue = string | number | boolean;

export type SecurityLogAttributes = {
  [key: string]: SecurityLogAttributeValue;
};

export type SecurityLogRecord = {
  name: string;
  timestamp: Date;
  severityText: "INFO" | "WARN";
  body: string;
  attributes: SecurityLogAttributes;
};

export type SecurityLogExporter = {
  export(records: readonly SecurityLogRecord[]): Promise<void>;
  shutdown?(): Promise<void>;
};

type SecurityLogLogger = (msg: string, err: Error) => void;

type StepCompletedPayload = BusEvents["workflow.step.completed"];
type GuardrailAssessedPayload = BusEvents["guardrail.assessed"];
type ApprovalRequestedPayload = BusEvents["approval.requested"];
type ApprovalResolvedPayload = BusEvents["approval.resolved"];

type ToolTelemetryArtifact = {
  calls?: ToolTelemetryCallRecord[];
  callsOmitted?: number;
};

type AgentStepResultArtifact = {
  output?: {
    sessionId?: string;
  };
};

type OtlpAnyValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean };

type OtlpAttribute = {
  key: string;
  value: OtlpAnyValue;
};

type OtlpFetchResponse = Pick<Response, "ok" | "status" | "text">;
type OtlpFetch = (
  url: string,
  init: {
    method: "POST";
    headers: { "content-type": "application/json" };
    body: string;
  },
) => Promise<OtlpFetchResponse>;

function textMetadata(prefix: string, value: string): SecurityLogAttributes {
  const bytes = measureTelemetryPayloadBytes(value);
  return {
    [`${prefix}.bytes`]: bytes,
    [`${prefix}.present`]: bytes > 0,
    [`${prefix}.omitted`]: bytes > 0,
  };
}

function optionalStringAttr(
  key: string,
  value: string | undefined,
): SecurityLogAttributes {
  return value ? { [key]: value } : {};
}

function optionalNumberAttr(
  key: string,
  value: number | undefined,
): SecurityLogAttributes {
  return value !== undefined ? { [key]: value } : {};
}

function optionalBooleanAttr(
  key: string,
  value: boolean | undefined,
): SecurityLogAttributes {
  return value !== undefined ? { [key]: value } : {};
}

function mcpToolAttributes(tool: string): SecurityLogAttributes {
  const parts = tool.split("__");
  if (parts.length < 3 || parts[0] !== "mcp" || !parts[1]) {
    return { "tool.mcp": false };
  }
  return {
    "tool.mcp": true,
    "mcp.server": parts[1],
    "mcp.tool": parts.slice(2).join("__"),
  };
}

function baseRecord(
  name: string,
  severityText: SecurityLogRecord["severityText"],
  attributes: SecurityLogAttributes,
): SecurityLogRecord {
  return {
    name,
    timestamp: new Date(),
    severityText,
    body: name,
    attributes: {
      "event.name": name,
      "kota.security_signal": name,
      ...attributes,
    },
  };
}

function workflowAttributes(payload: StepCompletedPayload): SecurityLogAttributes {
  return {
    "project.id": payload.projectId,
    "workflow.name": payload.workflow,
    "workflow.run_id": payload.runId,
    "workflow.step.id": payload.stepId,
    "workflow.step.type": payload.stepType,
    "workflow.step.status": payload.status,
    "workflow.step.duration_ms": payload.durationMs,
    ...optionalStringAttr("autonomy_mode", payload.autonomyMode),
  };
}

function readToolTelemetryArtifact(
  projectDir: string,
  runDir: string,
  stepId: string,
  onEnrichmentError: SecurityLogLogger,
): ToolTelemetryArtifact | undefined {
  const filePath = join(resolve(projectDir, runDir), "steps", `${stepId}.tool-telemetry.json`);
  if (!existsSync(filePath)) return undefined;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as ToolTelemetryArtifact;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    onEnrichmentError(`Security log emitter could not read tool telemetry ${filePath}`, err);
    return undefined;
  }
}

function readAgentStepSessionId(
  projectDir: string,
  runDir: string,
  stepId: string,
  onEnrichmentError: SecurityLogLogger,
): string | undefined {
  const filePath = join(resolve(projectDir, runDir), "steps", `${stepId}.json`);
  if (!existsSync(filePath)) return undefined;
  try {
    const artifact = JSON.parse(readFileSync(filePath, "utf-8")) as AgentStepResultArtifact;
    const sessionId = artifact.output?.sessionId;
    return typeof sessionId === "string" ? sessionId : undefined;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    onEnrichmentError(`Security log emitter could not read agent step result ${filePath}`, err);
    return undefined;
  }
}

function toAnyValue(value: SecurityLogAttributeValue): OtlpAnyValue {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { intValue: String(value) };
    return { doubleValue: value };
  }
  return { stringValue: value };
}

function toOtlpAttributes(attrs: SecurityLogAttributes): OtlpAttribute[] {
  return Object.entries(attrs).map(([key, value]) => ({
    key,
    value: toAnyValue(value),
  }));
}

function toUnixNanos(timestamp: Date): string {
  return String(BigInt(timestamp.getTime()) * 1_000_000n);
}

function toOtlpPayload(
  serviceName: string,
  records: readonly SecurityLogRecord[],
) {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: toOtlpAttributes({ "service.name": serviceName }),
        },
        scopeLogs: [
          {
            scope: { name: LOGGER_NAME },
            logRecords: records.map((record) => ({
              timeUnixNano: toUnixNanos(record.timestamp),
              severityText: record.severityText,
              body: { stringValue: record.body },
              attributes: toOtlpAttributes(record.attributes),
            })),
          },
        ],
      },
    ],
  };
}

export function resolveTracingLogEndpoint(config: TracingConfig): string {
  if (config.logsEndpoint) return config.logsEndpoint;
  return config.endpoint.replace(/\/v1\/(?:traces|metrics)$/, "/v1/logs");
}

export class OtlpHttpSecurityLogExporter implements SecurityLogExporter {
  constructor(
    private readonly url: string,
    private readonly serviceName: string = DEFAULT_SERVICE_NAME,
    private readonly fetchImpl: OtlpFetch = fetch,
  ) {}

  async export(records: readonly SecurityLogRecord[]): Promise<void> {
    if (records.length === 0) return;
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(toOtlpPayload(this.serviceName, records)),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `OTLP log export failed with HTTP ${response.status}: ${body.slice(0, 200)}`,
      );
    }
  }

  async shutdown(): Promise<void> {
    await Promise.resolve();
  }
}

export function createSecurityLogExporter(config: TracingConfig): SecurityLogExporter {
  return new OtlpHttpSecurityLogExporter(
    resolveTracingLogEndpoint(config),
    config.serviceName ?? DEFAULT_SERVICE_NAME,
  );
}

export class SecurityLogEmitter {
  constructor(
    private readonly projectDir: string,
    private readonly exporter: SecurityLogExporter,
    private readonly onExportError: SecurityLogLogger = () => {},
  ) {}

  onGuardrailAssessed(payload: GuardrailAssessedPayload): void {
    this.publish(baseRecord("guardrail.assessed", "INFO", {
      "tool.name": payload.tool,
      "tool.risk": payload.risk,
      "guardrail.policy": payload.policy,
      ...textMetadata("guardrail.reason", payload.reason),
      ...optionalStringAttr("session.id", payload.session),
      ...mcpToolAttributes(payload.tool),
    }));
  }

  onApprovalRequested(payload: ApprovalRequestedPayload): void {
    this.publish(baseRecord("approval.requested", "WARN", {
      "project.id": payload.projectId,
      "approval.id": payload.id,
      "tool.name": payload.tool,
      "tool.risk": payload.risk,
      ...optionalStringAttr("session.id", payload.sessionId),
      ...textMetadata("approval.source", payload.source),
      ...textMetadata("approval.reason", payload.reason),
      ...mcpToolAttributes(payload.tool),
    }));
  }

  onApprovalResolved(payload: ApprovalResolvedPayload): void {
    this.publish(baseRecord("approval.resolved", "INFO", {
      "project.id": payload.projectId,
      "approval.id": payload.id,
      "approval.approved": payload.approved,
      "approval.outcome": payload.approved ? "approved" : "rejected",
      "tool.name": payload.tool,
      ...optionalStringAttr("session.id", payload.sessionId),
      ...textMetadata("approval.source", payload.source),
      ...textMetadata("approval.reason", payload.reason),
      ...mcpToolAttributes(payload.tool),
    }));
  }

  onInjectionDefenseAssessed(payload: InjectionDefenseAssessedPayload): void {
    this.publish(baseRecord("injection.defense.assessed", payload.suspicious ? "WARN" : "INFO", {
      "tool.name": payload.tool,
      "injection.suspicious": payload.suspicious,
      "injection.action": payload.action,
      "injection.reason_count": payload.reasons.length,
      "injection.reason_tags": payload.reasons.join(","),
      "autonomy_mode": payload.autonomyMode,
      ...optionalStringAttr("session.id", payload.session),
      ...mcpToolAttributes(payload.tool),
    }));
  }

  onStepCompleted(payload: StepCompletedPayload): void {
    if (payload.stepType !== "agent") return;
    const artifact = readToolTelemetryArtifact(
      this.projectDir,
      payload.runDir,
      payload.stepId,
      this.onExportError,
    );
    if (!artifact) return;

    const sessionId = readAgentStepSessionId(
      this.projectDir,
      payload.runDir,
      payload.stepId,
      this.onExportError,
    );
    const baseAttrs = {
      ...workflowAttributes(payload),
      ...optionalStringAttr("session.id", sessionId),
    };
    for (const call of artifact.calls ?? []) {
      this.publish(baseRecord("agent.tool_call", call.success === false ? "WARN" : "INFO", {
        ...baseAttrs,
        "tool.name": call.tool,
        "tool.call_id": call.toolUseId,
        "tool.input_bytes": call.inputBytes,
        "tool.input_omitted": call.inputBytes > 0,
        "tool.incomplete": call.incomplete,
        "tool.truncated": call.truncated,
        ...optionalNumberAttr("tool.duration_ms", call.durationMs),
        ...optionalBooleanAttr("tool.success", call.success),
        ...optionalNumberAttr("tool.result_bytes", call.resultBytes),
        ...optionalBooleanAttr(
          "tool.result_omitted",
          call.resultBytes !== undefined ? call.resultBytes > 0 : undefined,
        ),
        ...optionalStringAttr("tool.result_content_kind", call.resultContentKind),
        ...mcpToolAttributes(call.tool),
      }));
    }

    if (artifact.callsOmitted && artifact.callsOmitted > 0) {
      this.publish(baseRecord("agent.tool_telemetry_omitted", "WARN", {
        ...baseAttrs,
        "tool.telemetry.calls_omitted": artifact.callsOmitted,
        "tool.telemetry.omission_reason": "max_call_records",
      }));
    }
  }

  private publish(record: SecurityLogRecord): void {
    void this.exporter.export([record]).catch((error: Error) => {
      this.onExportError(`Security log export failed for ${record.name}`, error);
    });
  }
}

export function subscribeSecurityLogEvents(
  events: ModuleEventProxy,
  emitter: SecurityLogEmitter,
): Array<() => void> {
  return [
    events.subscribe("guardrail.assessed", (payload) => {
      emitter.onGuardrailAssessed(payload);
    }),
    events.subscribe("approval.requested", (payload) => {
      emitter.onApprovalRequested(payload);
    }),
    events.subscribe("approval.resolved", (payload) => {
      emitter.onApprovalResolved(payload);
    }),
    events.subscribe(injectionDefenseAssessed, (payload) => {
      emitter.onInjectionDefenseAssessed(payload);
    }),
    events.subscribe("workflow.step.completed", (payload) => {
      emitter.onStepCompleted(payload);
    }),
  ];
}
