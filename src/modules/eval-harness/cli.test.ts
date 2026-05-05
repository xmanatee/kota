import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { KotaClient } from "#core/server/kota-client.js";
import {
  EVALUATOR_CALIBRATION_ARTIFACT,
  type EvaluatorCalibrationArtifact,
} from "#modules/autonomy/evaluator-calibration.js";
import { buildEvalCommand } from "./cli.js";
import type { EvalHarnessClient } from "./client.js";
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
  };
  writeFileSync(
    join(runDir, EVALUATOR_CALIBRATION_ARTIFACT),
    JSON.stringify(artifact, null, 2),
  );
}

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
