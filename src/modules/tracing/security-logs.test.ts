import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import tracingModule from "./index.js";
import {
  OtlpHttpSecurityLogExporter,
  resolveTracingLogEndpoint,
  SecurityLogEmitter,
  type SecurityLogExporter,
  type SecurityLogRecord,
} from "./security-logs.js";

class FakeSecurityLogExporter implements SecurityLogExporter {
  readonly records: SecurityLogRecord[] = [];

  async export(records: readonly SecurityLogRecord[]): Promise<void> {
    this.records.push(...records);
  }
}

function makeTmpDir(): string {
  const dir = join(tmpdir(), `kota-security-logs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function byName(
  records: readonly SecurityLogRecord[],
  name: string,
): SecurityLogRecord {
  const record = records.find((entry) => entry.name === name);
  expect(record).toBeDefined();
  return record!;
}

describe("SecurityLogEmitter", () => {
  afterEach(async () => {
    await tracingModule.onUnload?.();
  });

  it("does not subscribe or initialize exporters when tracing is disabled", async () => {
    const subscribe = vi.fn();
    const debug = vi.fn();
    const ctx = {
      cwd: makeTmpDir(),
      config: {},
      log: {
        debug,
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      events: { subscribe },
    } as unknown as ModuleRuntimeContext;

    await tracingModule.onLoad?.(ctx);

    expect(subscribe).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith("Tracing disabled (no endpoint configured)");
  });

  it("emits bounded records for guardrail, approval, and injection-defense signals", () => {
    const exporter = new FakeSecurityLogExporter();
    const emitter = new SecurityLogEmitter(makeTmpDir(), exporter);

    emitter.onGuardrailAssessed({
      tool: "shell",
      risk: "dangerous",
      policy: "queue",
      reason: "operator reason with SECRET_TOKEN",
      session: "session-1",
    });
    emitter.onApprovalRequested({
      projectId: "project-1",
      id: "approval-1",
      tool: "mcp__github__create_issue",
      risk: "dangerous",
      reason: "approval request with RAW_PAYLOAD",
      source: "session-1",
      sessionId: "session-1",
    });
    emitter.onApprovalResolved({
      projectId: "project-1",
      id: "approval-1",
      tool: "mcp__github__create_issue",
      approved: false,
      reason: "rejected because RAW_PAYLOAD",
      source: "session-1",
      sessionId: "session-1",
    });
    emitter.onInjectionDefenseAssessed({
      tool: "web_fetch",
      suspicious: true,
      reasons: ["role-marker", "override-phrase"],
      action: "annotate",
      autonomyMode: "autonomous",
      session: "session-1",
    });

    expect(exporter.records.map((record) => record.name)).toEqual([
      "guardrail.assessed",
      "approval.requested",
      "approval.resolved",
      "injection.defense.assessed",
    ]);

    const guardrail = byName(exporter.records, "guardrail.assessed");
    expect(guardrail.attributes).toMatchObject({
      "tool.name": "shell",
      "tool.risk": "dangerous",
      "guardrail.policy": "queue",
      "guardrail.reason.omitted": true,
      "session.id": "session-1",
    });
    expect(guardrail.attributes).not.toHaveProperty("project.id");

    const requested = byName(exporter.records, "approval.requested");
    expect(requested.attributes).toMatchObject({
      "project.id": "project-1",
      "approval.id": "approval-1",
      "session.id": "session-1",
      "approval.source.omitted": true,
      "approval.reason.omitted": true,
      "tool.mcp": true,
      "mcp.server": "github",
      "mcp.tool": "create_issue",
    });

    const resolved = byName(exporter.records, "approval.resolved");
    expect(resolved.attributes).toMatchObject({
      "project.id": "project-1",
      "approval.outcome": "rejected",
      "approval.approved": false,
      "session.id": "session-1",
      "approval.source.omitted": true,
    });

    const injection = byName(exporter.records, "injection.defense.assessed");
    expect(injection.attributes).toMatchObject({
      "tool.name": "web_fetch",
      "injection.suspicious": true,
      "injection.reason_count": 2,
      "injection.reason_tags": "role-marker,override-phrase",
      "autonomy_mode": "autonomous",
      "session.id": "session-1",
    });
    expect(injection.attributes).not.toHaveProperty("project.id");

    const serialized = JSON.stringify(exporter.records);
    expect(serialized).not.toContain("SECRET_TOKEN");
    expect(serialized).not.toContain("RAW_PAYLOAD");
  });

  it("emits one bounded record per agent tool call and marks MCP usage", () => {
    const projectDir = makeTmpDir();
    const runDir = ".kota/runs/run-1";
    const stepsDir = join(projectDir, runDir, "steps");
    mkdirSync(stepsDir, { recursive: true });
    writeFileSync(join(stepsDir, "build.input.md"), "raw prompt SECRET_PROMPT");
    writeFileSync(
      join(stepsDir, "build.json"),
      JSON.stringify({ output: { raw: "RAW_TOOL_OUTPUT", sessionId: "session-agent-1" } }),
    );
    writeFileSync(
      join(stepsDir, "build.tool-telemetry.json"),
      JSON.stringify({
        calls: [
          {
            toolUseId: "tu-1",
            tool: "mcp__github__get_issue",
            inputBytes: 1024,
            incomplete: false,
            truncated: false,
            durationMs: 42,
            success: true,
            resultBytes: 2048,
            resultContentKind: "text",
          },
          {
            toolUseId: "tu-2",
            tool: "shell",
            inputBytes: 64,
            incomplete: true,
            truncated: false,
          },
        ],
        callsOmitted: 7,
      }),
    );

    const exporter = new FakeSecurityLogExporter();
    const emitter = new SecurityLogEmitter(projectDir, exporter);
    emitter.onStepCompleted({
      projectId: "project-1",
      workflow: "builder",
      runId: "run-1",
      stepId: "build",
      stepType: "agent",
      status: "success",
      durationMs: 1234,
      runDir,
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      autonomyMode: "autonomous",
    });

    expect(exporter.records.map((record) => record.name)).toEqual([
      "agent.tool_call",
      "agent.tool_call",
      "agent.tool_telemetry_omitted",
    ]);

    const mcpCall = exporter.records[0]!;
    expect(mcpCall.attributes).toMatchObject({
      "project.id": "project-1",
      "workflow.name": "builder",
      "workflow.run_id": "run-1",
      "workflow.step.id": "build",
      "workflow.step.status": "success",
      "autonomy_mode": "autonomous",
      "session.id": "session-agent-1",
      "tool.name": "mcp__github__get_issue",
      "tool.call_id": "tu-1",
      "tool.input_bytes": 1024,
      "tool.input_omitted": true,
      "tool.result_bytes": 2048,
      "tool.result_omitted": true,
      "tool.success": true,
      "tool.duration_ms": 42,
      "tool.mcp": true,
      "mcp.server": "github",
      "mcp.tool": "get_issue",
    });

    const incompleteCall = exporter.records[1]!;
    expect(incompleteCall.attributes).toMatchObject({
      "tool.name": "shell",
      "tool.incomplete": true,
      "tool.mcp": false,
    });
    expect(incompleteCall.attributes).not.toHaveProperty("tool.result_bytes");

    const omitted = byName(exporter.records, "agent.tool_telemetry_omitted");
    expect(omitted.attributes).toMatchObject({
      "tool.telemetry.calls_omitted": 7,
      "tool.telemetry.omission_reason": "max_call_records",
      "session.id": "session-agent-1",
    });

    const serialized = JSON.stringify(exporter.records);
    expect(serialized).not.toContain("SECRET_PROMPT");
    expect(serialized).not.toContain("RAW_TOOL_OUTPUT");
  });
});

describe("OtlpHttpSecurityLogExporter", () => {
  it("derives and honors the security log endpoint", () => {
    expect(resolveTracingLogEndpoint({ endpoint: "http://localhost:4318/v1/traces" })).toBe(
      "http://localhost:4318/v1/logs",
    );
    expect(resolveTracingLogEndpoint({
      endpoint: "http://localhost:4318/v1/traces",
      logsEndpoint: "http://localhost:4318/custom/logs",
    })).toBe("http://localhost:4318/custom/logs");
  });

  it("posts OTLP log JSON without raw payload fields", async () => {
    const bodies: string[] = [];
    const exporter = new OtlpHttpSecurityLogExporter(
      "http://otel.example/v1/logs",
      "kota-test",
      async (_url, init) => {
        bodies.push(init.body);
        return { ok: true, status: 200, text: async () => "" };
      },
    );

    await exporter.export([
      {
        name: "agent.tool_call",
        timestamp: new Date("2026-05-17T13:00:00.000Z"),
        severityText: "INFO",
        body: "agent.tool_call",
        attributes: {
          "event.name": "agent.tool_call",
          "tool.name": "shell",
          "tool.input_bytes": 123,
          "tool.input_omitted": true,
        },
      },
    ]);

    expect(bodies).toHaveLength(1);
    const parsed = JSON.parse(bodies[0]!);
    const resourceLogs = parsed.resourceLogs[0];
    expect(resourceLogs.resource.attributes[0]).toEqual({
      key: "service.name",
      value: { stringValue: "kota-test" },
    });
    const logRecord = resourceLogs.scopeLogs[0].logRecords[0];
    expect(logRecord.body).toEqual({ stringValue: "agent.tool_call" });
    expect(JSON.stringify(parsed)).toContain("tool.input_bytes");
    expect(JSON.stringify(parsed)).not.toContain("printf raw command");
  });
});
