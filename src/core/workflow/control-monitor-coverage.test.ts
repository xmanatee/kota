import { mkdirSync } from "node:fs";
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

describe("control monitor coverage artifacts", () => {
  let fixture: ControlCoverageFixture;
  let projectDir: string;
  let runDirPath: string;

  beforeEach(() => {
    fixture = createControlCoverageFixture();
    projectDir = fixture.projectDir;
    runDirPath = fixture.runDirPath;
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it("summarizes covered control surfaces without copying raw payloads", () => {
    const metadata = baseMetadata({
      tags: ["monitored"],
      steps: [
        {
          id: "build",
          type: "agent",
          status: "success",
          startedAt: STARTED_AT,
          completedAt: COMPLETED_AT,
          durationMs: 55_000,
        },
        {
          id: "approve",
          type: "approval",
          status: "success",
          startedAt: STARTED_AT,
          completedAt: COMPLETED_AT,
          durationMs: 100,
        },
        {
          id: "owner-wait",
          type: "await-event",
          status: "success",
          startedAt: STARTED_AT,
          completedAt: COMPLETED_AT,
          durationMs: 100,
        },
      ],
    });
    writeJson(join(runDirPath, "workflow.json"), {
      defaultAutonomyMode: "autonomous",
      steps: [
        { id: "build", type: "agent" },
        { id: "approve", type: "approval" },
        {
          id: "owner-wait",
          type: "await-event",
          event: "owner.question.resolved",
        },
      ],
    });
    writeJsonl(join(runDirPath, "steps", "build.events.jsonl"), [
      { type: "agent-message", text: "SECRET_TOKEN should stay out" },
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
        { tool: "web_fetch", input: "SECRET_TOKEN should stay out" },
        { tool: "shell" },
      ],
    });
    writeJson(join(runDirPath, "runtime-probe.json"), { status: "passed" });
    writeJsonl(join(runDirPath, "emitted-events.jsonl"), [
      {
        event: "guardrail.assessed",
        payload: { policy: "allow", tool: "web_fetch" },
      },
      {
        event: "guardrail.assessed",
        payload: { policy: "deny", tool: "shell", control: "daemon-host-control" },
      },
      {
        event: "injection.defense.assessed",
        payload: { tool: "web_fetch", suspicious: false, redacted: "SECRET_TOKEN should stay out" },
      },
    ]);

    const reviewerDir = join(projectDir, ".kota", "runs", "review-run");
    mkdirSync(reviewerDir, { recursive: true });
    writeJson(join(reviewerDir, "metadata.json"), {
      ...baseMetadata({
        id: "review-run",
        workflow: "progress-reviewer",
        startedAt: "2026-06-22T10:02:00.000Z",
        completedAt: "2026-06-22T10:02:05.000Z",
        runDir: ".kota/runs/review-run",
      }),
      trigger: {
        event: "workflow.completed",
        schemaRef: null,
        payload: { runId: "run-control" },
      },
    });
    writeJson(join(reviewerDir, "progress-review.json"), { verdict: "pass" });

    const artifact = buildControlMonitorCoverageArtifact({
      projectDir,
      runDirPath,
      metadata,
      nowIso: "2026-06-22T10:03:00.000Z",
      headSha: "abc123",
    });

    expect(artifact.summary.gapCount).toBe(0);
    expect(artifact.monitoredSurfaceCounts).toMatchObject({
      agentSteps: 1,
      toolCalls: 2,
      externalPayloadIngests: 1,
      approvalRequests: 1,
      ownerQuestionWaits: 1,
      daemonHostControlDenials: 1,
      runtimeProbes: 1,
      postRunReviewLinks: 1,
    });
    expect(artifact.asyncReviewResponseMs).toMatchObject({
      observations: 1,
      min: 60_000,
      max: 60_000,
      average: 60_000,
    });
    expect(JSON.stringify(artifact)).not.toContain("SECRET_TOKEN");
  });

  it("counts agent-step evidence before step result metadata exists", () => {
    const metadata = baseMetadata({ steps: [] });
    writeJson(join(runDirPath, "workflow.json"), {
      defaultAutonomyMode: "autonomous",
      steps: [{ id: "build", type: "agent" }],
    });
    writeJsonl(join(runDirPath, "steps", "build.events.jsonl"), [
      { type: "text", text: "progress" },
    ]);
    writeJson(join(runDirPath, "steps", "build.harness-capability.json"), {
      emitsAgentMessageStream: true,
    });
    writeJson(join(runDirPath, "steps", "build.trajectory-diagnostics.json"), {
      status: "ok",
      counts: { warningCount: 0 },
    });

    const artifact = buildControlMonitorCoverageArtifact({
      projectDir,
      runDirPath,
      metadata,
      headSha: null,
    });

    expect(artifact.monitoredSurfaceCounts.agentSteps).toBe(1);
    expect(artifact.families).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "agent-step-stream",
          status: "covered",
          numerator: 1,
          denominator: 1,
        }),
      ]),
    );
  });

  it("treats failed validation-buffered agent streams as pending coverage", () => {
    const metadata = baseMetadata({
      steps: [
        {
          id: "review",
          type: "agent",
          status: "failed",
          startedAt: STARTED_AT,
          completedAt: COMPLETED_AT,
          durationMs: 55_000,
          error: "Step timed out",
        },
      ],
    });
    writeJson(join(runDirPath, "workflow.json"), {
      defaultAutonomyMode: "passive",
      steps: [
        {
          id: "review",
          type: "agent",
          agentMessageStreamPolicy: "buffer-until-validation-success",
        },
      ],
    });
    writeJson(join(runDirPath, "steps", "review.json"), metadata.steps[0]);
    writeJson(join(runDirPath, "steps", "review.harness-capability.json"), {
      emitsAgentMessageStream: true,
    });

    const artifact = buildControlMonitorCoverageArtifact({
      projectDir,
      runDirPath,
      metadata,
      headSha: null,
    });

    expect(artifact.gaps.map((gap) => gap.reason)).not.toEqual(
      expect.arrayContaining([
        "missing-agent-step-events",
        "missing-trajectory-diagnostics",
      ]),
    );
    expect(artifact.families).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "agent-step-stream",
          status: "pending",
          pending: 1,
        }),
        expect.objectContaining({
          family: "trajectory-diagnostics",
          status: "pending",
          pending: 1,
        }),
      ]),
    );
  });

  it("uses missing-frame diagnostics as observed stream evidence", () => {
    const metadata = baseMetadata({
      steps: [
        {
          id: "build",
          type: "agent",
          status: "failed",
          startedAt: STARTED_AT,
          completedAt: COMPLETED_AT,
          durationMs: 55_000,
          error: "Agent step idle timed out",
        },
      ],
    });
    writeJson(join(runDirPath, "workflow.json"), {
      defaultAutonomyMode: "autonomous",
      steps: [{ id: "build", type: "agent" }],
    });
    writeJson(join(runDirPath, "steps", "build.harness-capability.json"), {
      emitsAgentMessageStream: true,
    });
    writeJson(join(runDirPath, "steps", "build.trajectory-diagnostics.json"), {
      status: "supported",
      counts: {
        warningCount: 1,
        missingStreamingFramesCount: 1,
      },
    });

    const artifact = buildControlMonitorCoverageArtifact({
      projectDir,
      runDirPath,
      metadata,
      headSha: null,
    });

    expect(artifact.gaps.map((gap) => gap.reason)).not.toContain(
      "missing-agent-step-events",
    );
    expect(artifact.families).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "agent-step-stream",
          status: "covered",
          numerator: 1,
          warned: 1,
        }),
        expect.objectContaining({
          family: "trajectory-diagnostics",
          status: "covered",
          numerator: 1,
          warned: 1,
        }),
      ]),
    );
  });

  it("does not treat skipped approval or owner-question gates as unresolved", () => {
    const metadata = baseMetadata({
      steps: [
        {
          id: "approve-comment",
          type: "approval",
          status: "skipped",
          startedAt: STARTED_AT,
          completedAt: COMPLETED_AT,
          durationMs: 10,
          skipReason: { kind: "when-predicate" },
        },
        {
          id: "owner-wait",
          type: "await-event",
          status: "skipped",
          startedAt: STARTED_AT,
          completedAt: COMPLETED_AT,
          durationMs: 10,
          skipReason: { kind: "when-predicate" },
        },
      ],
    });
    writeJson(join(runDirPath, "workflow.json"), {
      steps: [
        { id: "approve-comment", type: "approval" },
        {
          id: "owner-wait",
          type: "await-event",
          event: "owner.question.resolved",
        },
      ],
    });

    const artifact = buildControlMonitorCoverageArtifact({
      projectDir,
      runDirPath,
      metadata,
      nowIso: "2026-06-22T10:03:00.000Z",
      headSha: "abc123",
    });

    expect(artifact.summary.gapCount).toBe(0);
    expect(artifact.monitoredSurfaceCounts).toMatchObject({
      approvalRequests: 0,
      ownerQuestionWaits: 0,
    });
    expect(artifact.families).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "approval-owner-gates",
          status: "not-applicable",
          numerator: 0,
          denominator: 0,
        }),
      ]),
    );
  });
});
