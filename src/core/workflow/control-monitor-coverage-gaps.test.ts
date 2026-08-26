import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildControlMonitorCoverageArtifact } from "./control-monitor-coverage.js";
import {
  baseMetadata,
  COMPLETED_AT,
  type ControlCoverageFixture,
  createControlCoverageFixture,
  STARTED_AT,
  writeJson,
  writeJsonl,
} from "./control-monitor-coverage-test-support.js";

describe("control monitor coverage gaps", () => {
  let fixture: ControlCoverageFixture;
  let scopeRoot: string;
  let runDirPath: string;

  beforeEach(() => {
    fixture = createControlCoverageFixture("kota-control-coverage-gaps");
    scopeRoot = fixture.workspaceRoot;
    runDirPath = fixture.runDirPath;
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it("records attribution gaps for monitor events without step telemetry", () => {
    const metadata = baseMetadata();
    writeJson(join(runDirPath, "workflow.json"), { steps: [] });
    writeJsonl(join(runDirPath, "emitted-events.jsonl"), [
      {
        event: "guardrail.assessed",
        payload: {
          policy: "deny",
          tool: "shell",
          control: "daemon-host-control",
        },
      },
      {
        event: "injection.defense.assessed",
        payload: {
          tool: "web_fetch",
          suspicious: false,
          reasons: [],
          action: "skip",
          autonomyMode: "autonomous",
        },
      },
    ]);

    const artifact = buildControlMonitorCoverageArtifact({
      scopeRoot,
      runDirPath,
      metadata,
      headSha: null,
    });

    expect(artifact.monitoredSurfaceCounts).toMatchObject({
      toolCalls: 0,
      externalPayloadIngests: 0,
      daemonHostControlDenials: 1,
    });
    expect(artifact.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "tool-policy",
          reason: "unattributed-tool-policy-decision-event",
          subject: "1 guardrail/control event(s)",
          evidenceRefs: [".kota/runs/run-control/emitted-events.jsonl#L1"],
        }),
        expect.objectContaining({
          family: "injection-defense",
          reason: "unattributed-injection-defense-event",
          subject: "1 injection-defense event(s)",
          evidenceRefs: [".kota/runs/run-control/emitted-events.jsonl#L2"],
        }),
      ]),
    );
  });

  it("records explicit gaps for missing or unsupported control evidence", () => {
    const metadata = baseMetadata({
      steps: [
        {
          id: "build",
          type: "agent",
          status: "success",
          startedAt: STARTED_AT,
          completedAt: COMPLETED_AT,
          durationMs: 55_000,
        },
      ],
    });
    writeJson(join(runDirPath, "workflow.json"), {
      steps: [{ id: "build", type: "agent" }],
    });
    writeJson(join(runDirPath, "steps", "build.harness-capability.json"), {
      emitsAgentMessageStream: false,
    });
    writeJson(join(runDirPath, "steps", "build.trajectory-diagnostics.json"), {
      status: "unsupported",
      counts: { warningCount: 1 },
    });
    writeJson(join(runDirPath, "steps", "build.tool-telemetry.json"), {
      calls: [{ tool: "web_fetch" }],
    });

    const artifact = buildControlMonitorCoverageArtifact({
      scopeRoot,
      runDirPath,
      metadata,
      headSha: null,
    });

    const gapReasons = artifact.gaps.map((gap) => gap.reason);
    expect(gapReasons).toEqual(
      expect.arrayContaining([
        "unsupported-agent-message-stream",
        "missing-agent-step-autonomy-mode",
        "unsupported-trajectory-diagnostics",
        "missing-tool-policy-decision-evidence",
        "external-payload-unscreened",
      ]),
    );
    expect(artifact.summary.unsupportedCount).toBeGreaterThanOrEqual(2);
    expect(artifact.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "injection-defense",
          severity: "error",
          evidenceRefs: expect.arrayContaining([
            ".kota/runs/run-control/metadata.json",
          ]),
        }),
      ]),
    );
  });
});
