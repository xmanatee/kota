import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildControlMonitorCoverageArtifact } from "./control-monitor-coverage.js";
import type { WorkflowRunMetadata } from "./run-types.js";

const STARTED_AT = "2026-06-22T10:00:00.000Z";

function writeJson(path: string, value: object): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function writeJsonl(path: string, values: readonly object[]): void {
  writeFileSync(
    path,
    `${values.map((value) => JSON.stringify(value)).join("\n")}\n`,
    "utf-8",
  );
}

function baseMetadata(
  overrides: Partial<WorkflowRunMetadata> = {},
): WorkflowRunMetadata {
  const id = overrides.id ?? "run-control";
  return {
    id,
    workflow: "builder",
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    trigger: {
      event: "autonomy.queue.available",
      schemaRef: null,
      payload: {},
    },
    startedAt: STARTED_AT,
    completedAt: "2026-06-22T10:01:00.000Z",
    status: "success",
    durationMs: 60_000,
    runDir: `.kota/runs/${id}`,
    steps: [],
    ...overrides,
  };
}

describe("control monitor coverage telemetry", () => {
  let projectDir: string;
  let runDirPath: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-control-coverage-telemetry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    runDirPath = join(projectDir, ".kota", "runs", "run-control");
    mkdirSync(join(runDirPath, "steps"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("counts dynamic external MCP payloads from telemetry provenance", () => {
    const metadata = baseMetadata({
      steps: [
        {
          id: "build",
          type: "agent",
          status: "success",
          startedAt: STARTED_AT,
          completedAt: "2026-06-22T10:01:00.000Z",
          durationMs: 55_000,
        },
      ],
    });
    writeJson(join(runDirPath, "workflow.json"), {
      defaultAutonomyMode: "autonomous",
      steps: [{ id: "build", type: "agent" }],
    });
    writeJsonl(join(runDirPath, "steps", "build.events.jsonl"), [
      { type: "tool_call", toolName: "mcp__remote__lookup" },
    ]);
    writeJson(join(runDirPath, "steps", "build.harness-capability.json"), {
      emitsAgentMessageStream: true,
    });
    writeJson(join(runDirPath, "steps", "build.trajectory-diagnostics.json"), {
      status: "ok",
      counts: { warningCount: 0 },
    });
    writeJson(join(runDirPath, "steps", "build.tool-telemetry.json"), {
      calls: [
        {
          tool: "mcp__remote__lookup",
          resultContentProvenance: {
            kind: "external-mcp",
            serverName: "remote",
            source: "tool",
            name: "lookup",
          },
        },
      ],
    });

    const artifact = buildControlMonitorCoverageArtifact({
      projectDir,
      runDirPath,
      metadata,
      headSha: null,
    });

    expect(artifact.monitoredSurfaceCounts.externalPayloadIngests).toBe(1);
    expect(artifact.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "injection-defense",
          reason: "external-payload-unscreened",
          severity: "error",
        }),
      ]),
    );
  });

  it("counts Claude SDK native web tools as external payload ingests", () => {
    const metadata = baseMetadata({
      steps: [
        {
          id: "build",
          type: "agent",
          status: "success",
          startedAt: STARTED_AT,
          completedAt: "2026-06-22T10:01:00.000Z",
          durationMs: 55_000,
        },
      ],
    });
    writeJson(join(runDirPath, "workflow.json"), {
      defaultAutonomyMode: "autonomous",
      steps: [{ id: "build", type: "agent" }],
    });
    writeJsonl(join(runDirPath, "steps", "build.events.jsonl"), [
      { type: "tool_call", toolName: "WebFetch" },
      { type: "tool_call", toolName: "WebSearch" },
    ]);
    writeJson(join(runDirPath, "steps", "build.harness-capability.json"), {
      emitsAgentMessageStream: true,
    });
    writeJson(join(runDirPath, "steps", "build.trajectory-diagnostics.json"), {
      status: "ok",
      counts: { warningCount: 0 },
    });
    writeJson(join(runDirPath, "steps", "build.tool-telemetry.json"), {
      calls: [{ tool: "WebFetch" }, { tool: "WebSearch" }],
    });

    const artifact = buildControlMonitorCoverageArtifact({
      projectDir,
      runDirPath,
      metadata,
      headSha: null,
    });

    expect(artifact.monitoredSurfaceCounts.externalPayloadIngests).toBe(2);
    expect(artifact.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "injection-defense",
          reason: "external-payload-unscreened",
          severity: "error",
          subject: "2 external payload(s)",
        }),
      ]),
    );
  });
});
