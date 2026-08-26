import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/usage.js";
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

function writeTokenBudgetArtifact(runDirPath: string): void {
  writeJson(join(runDirPath, "steps", "build.token-budget.json"), {
    artifactKind: "agent-token-budget",
    schemaVersion: 1,
    workflow: "builder",
    runId: "run-control",
    stepId: "build",
    snapshot: {
      budget: { maxTotalTokens: 100 },
      usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
      remainingTokens: 75,
      exhausted: false,
      debits: [],
      diagnostics: [],
    },
  });
}

describe("control monitor token-budget coverage", () => {
  let fixture: ControlCoverageFixture;
  let projectDir: string;
  let runDirPath: string;

  beforeEach(() => {
    fixture = createControlCoverageFixture("kota-control-coverage-token-budget");
    projectDir = fixture.projectDir;
    runDirPath = fixture.runDirPath;
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it("reports token-budget coverage when a budgeted agent step writes a ledger artifact", () => {
    const metadata = baseMetadata({
      steps: [
        {
          id: "build",
          type: "agent",
          status: "success",
          startedAt: STARTED_AT,
          completedAt: COMPLETED_AT,
          durationMs: 1000,
          usage: UNKNOWN_AGENT_USAGE,
        },
      ],
    });
    writeJson(join(runDirPath, "workflow.json"), {
      defaultAutonomyMode: "autonomous",
      steps: [
        {
          id: "build",
          type: "agent",
          tokenBudget: { maxTotalTokens: 100 },
        },
      ],
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
    writeTokenBudgetArtifact(runDirPath);

    const artifact = buildControlMonitorCoverageArtifact({
      projectDir,
      runDirPath,
      metadata,
      headSha: null,
    });

    expect(artifact.families).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "token-budget",
          status: "covered",
          numerator: 1,
          denominator: 1,
          warned: 0,
        }),
      ]),
    );
  });

  it("reports config-level token-budget coverage from the emitted ledger artifact", () => {
    const metadata = baseMetadata({
      steps: [
        {
          id: "build",
          type: "agent",
          status: "success",
          startedAt: STARTED_AT,
          completedAt: COMPLETED_AT,
          durationMs: 1000,
          usage: UNKNOWN_AGENT_USAGE,
        },
      ],
    });
    writeJson(join(runDirPath, "workflow.json"), {
      defaultAutonomyMode: "autonomous",
      steps: [{ id: "build", type: "agent" }],
    });
    writeTokenBudgetArtifact(runDirPath);

    const artifact = buildControlMonitorCoverageArtifact({
      projectDir,
      runDirPath,
      metadata,
      headSha: null,
    });

    expect(artifact.families).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "token-budget",
          status: "covered",
          numerator: 1,
          denominator: 1,
        }),
      ]),
    );
  });
});
