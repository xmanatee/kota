import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { KotaClient } from "#core/server/kota-client.js";
import { getCriticPromptHash } from "#modules/autonomy/critic.js";
import {
  EVALUATOR_CALIBRATION_ARTIFACT,
  type EvaluatorCalibrationArtifact,
} from "#modules/autonomy/evaluator-calibration.js";
import { buildEvalCommand } from "./cli.js";
import type { EvalHarnessClient, EvalRunOptions } from "./client.js";
import {
  listEvalFixtures,
  runEvalCalibration,
  runEvalHarness,
} from "./eval-operations.js";

function makeFakeCtx(projectDir: string): ModuleContext {
  const evalHarness: EvalHarnessClient = {
    async list() {
      return listEvalFixtures(projectDir);
    },
    async run(options) {
      return runEvalHarness(projectDir, options ?? {});
    },
    async calibration(options) {
      return runEvalCalibration(projectDir, options ?? {});
    },
  };
  const client = { evalHarness } as unknown as KotaClient;
  return { cwd: projectDir, client } as unknown as ModuleContext;
}

function makeRunRecordingCtx(calls: EvalRunOptions[]): ModuleContext {
  const evalHarness: EvalHarnessClient = {
    async list() {
      return { fixtures: [] };
    },
    async run(options) {
      calls.push(options ?? {});
      return {
        ok: true,
        fixtureCount: 1,
        repeatCount: options?.repeatCount ?? 1,
        passAtK: 1,
        passHatK: 1,
        objectiveMetrics: [],
        runArtifactBaseDir: "/tmp/eval-run",
      };
    },
    async calibration() {
      return { aggregate: {}, decision: {} };
    },
  };
  const client = { evalHarness } as unknown as KotaClient;
  return { cwd: "/tmp/project", client } as unknown as ModuleContext;
}

function seedCalibration(
  runsDir: string,
  runId: string,
  completedAt: string,
  verdict: EvaluatorCalibrationArtifact["verdict"],
  sourceFilesChanged: string[],
): void {
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  const artifact: EvaluatorCalibrationArtifact = {
    runId,
    workflow: "builder",
    completedAt,
    verdict,
    warningCount: 0,
    criticalIssueCount: 0,
    repairIterations: 1,
    finalIterationFailures: [],
    criticFailureCount: 0,
    terminalRunStatus: "success",
    taskId: null,
    taskFinalState: null,
    sourceFilesChanged,
    // CLI calibration aggregation runs through the live `getCriticPromptHash`,
    // so seeded artifacts must declare the same hash to be visible.
    criticPromptHash: getCriticPromptHash(),
  };
  writeFileSync(
    join(runDir, EVALUATOR_CALIBRATION_ARTIFACT),
    JSON.stringify(artifact, null, 2),
  );
}

describe("kota eval run CLI", () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("threads deliberate container selection into the eval run options", async () => {
    const calls: EvalRunOptions[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const cmd = buildEvalCommand(makeRunRecordingCtx(calls));

    await cmd.parseAsync(
      [
        "run",
        "--fixture",
        "builder-smoke",
        "--repeats",
        "1",
        "--host-class",
        "ci-container",
        "--cpu-allocation",
        "2",
        "--cpu-kill",
        "2",
        "--memory-allocation-mb",
        "1024",
        "--memory-kill-threshold-mb",
        "2048",
        "--isolation",
        "container",
        "--container-executable",
        "docker",
        "--container-image",
        "node:22-bookworm",
        "--container-kota-binary-path",
        "/opt/kota/bin/kota.mjs",
      ],
      { from: "user" },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      fixtureIds: ["builder-smoke"],
      repeatCount: 1,
      hostClass: "ci-container",
      cpuAllocationCores: 2,
      cpuKillThresholdCores: 2,
      memoryAllocationMB: 1024,
      memoryKillThresholdMB: 2048,
      isolationBackend: {
        kind: "container",
        executable: "docker",
        image: "node:22-bookworm",
        kotaBinaryPath: "/opt/kota/bin/kota.mjs",
      },
    });
  });

  it("rejects container fields unless the operator selects container isolation", async () => {
    const calls: EvalRunOptions[] = [];
    const cmd = buildEvalCommand(makeRunRecordingCtx(calls));

    await expect(
      cmd.parseAsync(
        [
          "run",
          "--container-executable",
          "docker",
          "--container-image",
          "node:22",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow(/require --isolation container/);
    expect(calls).toHaveLength(0);
  });
});

describe("kota eval calibration CLI", () => {
  let projectDir: string;
  let runsDir: string;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "cal-cli-"));
    runsDir = join(projectDir, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
    process.exitCode = 0;
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("aggregates seeded artifacts and prints human-readable summary", async () => {
    const nowIso = new Date().toISOString();
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    seedCalibration(runsDir, "run-a", hourAgo, "pass", ["src/core/a.ts"]);
    seedCalibration(runsDir, "run-b", nowIso, "fail", ["src/core/a.ts"]);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    });
    vi.spyOn(process.stdout, "write").mockImplementation((data) => {
      logs.push(String(data));
      return true;
    });

    const cmd = buildEvalCommand(makeFakeCtx(projectDir));
    await cmd.parseAsync(
      ["calibration", "--min-sample", "1", "--threshold-rate", "0.9"],
      { from: "user" },
    );

    const text = logs.join("\n");
    expect(text).toContain("evaluator calibration");
    expect(text).toContain("total runs=2");
    expect(text).toContain("pass=1");
    expect(text).toContain("pass contradiction: 1/1");
  });

  it("sets exitCode=2 and emits JSON when gated", async () => {
    const nowIso = new Date().toISOString();
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    seedCalibration(runsDir, "run-a", hourAgo, "pass", ["src/core/a.ts"]);
    seedCalibration(runsDir, "run-b", nowIso, "fail", ["src/core/a.ts"]);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    });

    const cmd = buildEvalCommand(makeFakeCtx(projectDir));
    await cmd.parseAsync(
      [
        "calibration",
        "--min-sample",
        "1",
        "--threshold-rate",
        "0.25",
        "--json",
      ],
      { from: "user" },
    );

    expect(process.exitCode).toBe(2);
    const parsed = JSON.parse(logs.join("\n")) as {
      aggregate: { passContradictionCount: number };
      decision: { status: string };
    };
    expect(parsed.aggregate.passContradictionCount).toBe(1);
    expect(parsed.decision.status).toBe("gated");
  });

  it("reports insufficient-sample when fewer pass verdicts than minSample", async () => {
    const nowIso = new Date().toISOString();
    seedCalibration(runsDir, "run-a", nowIso, "pass", ["src/core/a.ts"]);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    });
    vi.spyOn(process.stdout, "write").mockImplementation((data) => {
      logs.push(String(data));
      return true;
    });

    const cmd = buildEvalCommand(makeFakeCtx(projectDir));
    await cmd.parseAsync(
      ["calibration", "--min-sample", "8", "--threshold-rate", "0.25"],
      { from: "user" },
    );

    expect(process.exitCode).toBe(0);
    const text = logs.join("\n");
    expect(text).toContain("insufficient-sample");
  });
});
