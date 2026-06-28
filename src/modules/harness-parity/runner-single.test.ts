import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentHarness } from "#core/agent-harness/index.js";
import { runScenarioAcrossHarnesses, runScenarioOnHarness } from "./runner.js";
import { cleanupRunnerTestState, makeHarness, setupRunnerTestState } from "./runner.test-support.js";
import { loadScenario } from "./scenario.js";

describe("harness-parity runner single-stage execution", () => {
let scenariosRoot: string;
let outRoot: string;

beforeEach(() => {
  ({ scenariosRoot, outRoot } = setupRunnerTestState());
});

afterEach(() => {
  cleanupRunnerTestState({ scenariosRoot, outRoot });
});

  it("passes verification when the harness applies the expected fix", async () => {
    const scenario = loadScenario(scenariosRoot, "fix-add");
    const harness = makeHarness("fixing", (workingDir) => {
      writeFileSync(
        join(workingDir, "add.js"),
        "exports.add = (a, b) => a + b;\n",
      );
    });

    const artifact = await runScenarioOnHarness({
      scenario,
      harness,
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    expect(artifact.verification.passed).toBe(true);
    expect(artifact.changedFiles).toContain("add.js");
    expect(artifact.harnessName).toBe("fixing");
    expect(artifact.isError).toBe(false);
    expect(artifact.effort).toBe("xhigh");
    expect(artifact.stageMode).toBe("single");
    expect(artifact.stagedSummary).toMatchObject({
      mode: "single",
      passed: true,
      stageCount: 1,
    });
    expect(artifact.trajectory).toMatchObject({
      status: "unsupported",
      emitsAgentMessageStream: false,
      frameCount: 0,
      artifactPath: join(artifact.artifactDir, "trajectory.json"),
      summaryPath: join(artifact.artifactDir, "trajectory-summary.md"),
    });
    expect(artifact.trajectoryDiagnostics).toMatchObject({
      warningCount: 1,
      artifactPath: join(artifact.artifactDir, "trajectory-diagnostics.json"),
    });

    const artifactMetadata = JSON.parse(
      readFileSync(join(artifact.artifactDir, "run-meta.json"), "utf-8"),
    );
    expect(artifactMetadata.verification).toMatchObject({
      command: "node -e \"require('./add.js').add(2,3)===5 || process.exit(1)\"",
      timeoutMs: 10_000,
      passed: true,
      exitStatus: 0,
      timedOut: false,
    });
    expect(artifactMetadata.effort).toBe("xhigh");
    expect(artifactMetadata.capability).toMatchObject({
      emitsAgentMessageStream: false,
      toolControl: "kota",
    });
    expect(artifactMetadata.stages[0]).toMatchObject({
      stageId: "main",
      verification: { passed: true },
      trajectory: { status: "unsupported" },
      trajectoryDiagnostics: { warningCount: 1 },
    });

    const summary = readFileSync(
      join(artifact.artifactDir, "trace-summary.md"),
      "utf-8",
    );
    expect(summary).toContain("- effort: xhigh");
    expect(summary).toContain("- verification: pass (exit 0)");
    expect(summary).toContain("- trajectoryDiagnostics: warnings=1, artifact=");
    expect(summary).toContain("- emitsAgentMessageStream: false");

    const trace = readFileSync(join(artifact.artifactDir, "trace.txt"), "utf-8");
    expect(trace).toContain("ran with prompt");

    const verificationArtifact = JSON.parse(
      readFileSync(join(artifact.artifactDir, "verification.json"), "utf-8"),
    );
    expect(verificationArtifact).toMatchObject({
      passed: true,
      exitStatus: 0,
      timedOut: false,
    });

    const trajectoryArtifact = JSON.parse(
      readFileSync(join(artifact.artifactDir, "trajectory.json"), "utf-8"),
    );
    expect(trajectoryArtifact).toMatchObject({
      status: "unsupported",
      reason:
        "Harness capability snapshot declares emitsAgentMessageStream=false.",
      counts: {
        frameCount: 0,
        truncatedFrameCount: 0,
      },
    });

    const diff = readFileSync(join(artifact.artifactDir, "diff.patch"), "utf-8");
    expect(diff).toContain("add.js");
  });

  it("records a verification failure when the harness leaves the bug in place", async () => {
    const scenario = loadScenario(scenariosRoot, "fix-add");
    const harness = makeHarness("text-only", () => {
      // Simulates thin harness: text response, no file edits.
    });

    const artifact = await runScenarioOnHarness({
      scenario,
      harness,
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    expect(artifact.verification.passed).toBe(false);
    expect(artifact.changedFiles).toEqual([]);
    expect(artifact.isError).toBe(false);
  });

  it("captures harness errors without crashing the runner", async () => {
    const scenario = loadScenario(scenariosRoot, "fix-add");
    const failing: AgentHarness = {
      name: "broken",
      description: "broken",
      supportsMultiTurn: true,
      supportedHookKinds: ["preRun", "postRun"] as const,
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      async run() {
        throw new Error("adapter exploded");
      },
    };

    const artifact = await runScenarioOnHarness({
      scenario,
      harness: failing,
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    expect(artifact.isError).toBe(true);
    expect(artifact.verification.passed).toBe(false);
    const meta = JSON.parse(
      readFileSync(join(artifact.artifactDir, "run-meta.json"), "utf-8"),
    );
    expect(meta.error.message).toBe("adapter exploded");
  });

  it("writes paired artifacts under one directory per scenario across harnesses", async () => {
    const scenario = loadScenario(scenariosRoot, "fix-add");
    const passing = makeHarness("passing", (workingDir) => {
      writeFileSync(
        join(workingDir, "add.js"),
        "exports.add = (a, b) => a + b;\n",
      );
    });
    const failing = makeHarness("failing", () => {
      // no file change
    });

    const artifacts = await runScenarioAcrossHarnesses({
      scenario,
      harnesses: [passing, failing],
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    expect(artifacts.map((a) => a.harnessName)).toEqual(["passing", "failing"]);
    expect(artifacts[0]?.verification.passed).toBe(true);
    expect(artifacts[1]?.verification.passed).toBe(false);

    const parity = JSON.parse(
      readFileSync(join(outRoot, "fix-add", "parity.json"), "utf-8"),
    );
    expect(parity.artifacts).toHaveLength(2);
    expect(parity.artifacts[0].verificationPassed).toBe(true);
    expect(parity.artifacts[1].verificationPassed).toBe(false);
    expect(parity.artifacts[0].effort).toBe("xhigh");
    expect(parity.artifacts[1].effort).toBe("xhigh");
  });

  it("leaves the scenario initial/ tree untouched", async () => {
    const scenario = loadScenario(scenariosRoot, "fix-add");
    const harness = makeHarness("tampering", (workingDir) => {
      writeFileSync(
        join(workingDir, "add.js"),
        "exports.add = (a, b) => a + b;\n",
      );
    });

    await runScenarioOnHarness({
      scenario,
      harness,
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    const initialAdd = readFileSync(
      join(scenario.initialStateDir, "add.js"),
      "utf-8",
    );
    expect(initialAdd).toBe("exports.add = (a, b) => a - b;\n");
  });
});
