/**
 * Shared list/run/calibration logic for the `evalHarness` namespace.
 *
 * The CLI subcommands and the daemon control routes both reach these
 * helpers so daemon-up and daemon-down operators see the same fixture
 * set, the same run report shape, and the same calibration aggregate.
 */
import { mkdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import type { EventBus } from "#core/events/event-bus.js";
import type {
  EvalCalibrationOptions,
  EvalCalibrationResult,
  EvalListResult,
  EvalRunOptions,
  EvalRunResult,
} from "#core/server/kota-client.js";
import {
  aggregateCalibration,
  DEFAULT_CALIBRATION_MIN_SAMPLE,
  DEFAULT_CALIBRATION_THRESHOLD_RATE,
  evaluateCalibrationGate,
} from "#modules/autonomy/evaluator-calibration.js";
import { runEvalSet } from "./eval-set.js";
import { FixtureProvenanceError, loadAllFixtures, loadFixture } from "./fixture.js";
import type { ResourceProfile } from "./fixture-run.js";
import { createSubprocessExecutor } from "./subprocess-executor.js";

export const DEFAULT_HOST_CLASS = "local-dev";
export const DEFAULT_CPU_ALLOC = 2;
export const DEFAULT_MEM_ALLOC_MB = 4096;
const DEFAULT_REPEATS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function fixturesRootFor(projectDir: string): string {
  return join(projectDir, "src/modules/eval-harness/fixtures");
}

function evalRunsRootFor(projectDir: string): string {
  return join(projectDir, ".kota/eval-runs");
}

function kotaBinaryPathFor(projectDir: string): string {
  return resolve(join(projectDir, "bin/kota.mjs"));
}

export function listEvalFixtures(projectDir: string): EvalListResult {
  const fixtures = loadAllFixtures(fixturesRootFor(projectDir));
  return {
    fixtures: fixtures.map((f) => ({
      id: f.spec.id,
      description: f.spec.description,
      role: f.spec.role,
      workflowName: f.spec.workflowName,
      tags: [...(f.spec.tags ?? [])],
    })),
  };
}

function buildProfile(options: EvalRunOptions, defaultHost: string): ResourceProfile {
  const cpuAllocationCores = options.cpuAllocationCores ?? DEFAULT_CPU_ALLOC;
  const cpuKillThresholdCores = options.cpuKillThresholdCores ?? cpuAllocationCores;
  const memoryAllocationMB = options.memoryAllocationMB ?? DEFAULT_MEM_ALLOC_MB;
  const memoryKillThresholdMB = options.memoryKillThresholdMB ?? memoryAllocationMB;
  return {
    hostClass: options.hostClass ?? defaultHost,
    cpuAllocationCores,
    cpuKillThresholdCores,
    memoryAllocationMB,
    memoryKillThresholdMB,
  };
}

export async function runEvalHarness(
  projectDir: string,
  options: EvalRunOptions = {},
  bus?: EventBus,
): Promise<EvalRunResult> {
  const fixturesRoot = fixturesRootFor(projectDir);
  let fixtures;
  try {
    fixtures = options.fixtureIds && options.fixtureIds.length > 0
      ? options.fixtureIds.map((id) => loadFixture(fixturesRoot, id))
      : loadAllFixtures(fixturesRoot);
  } catch (err) {
    if (err instanceof FixtureProvenanceError) {
      return { ok: false, reason: "fixture_provenance", message: err.message };
    }
    throw err;
  }
  if (fixtures.length === 0) {
    return { ok: false, reason: "no_fixtures", message: `No fixtures under "${fixturesRoot}".` };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runArtifactBaseDir = join(evalRunsRootFor(projectDir), stamp);
  mkdirSync(runArtifactBaseDir, { recursive: true });
  const profile = buildProfile(options, DEFAULT_HOST_CLASS);
  const executor = createSubprocessExecutor({ kotaBinaryPath: kotaBinaryPathFor(projectDir) });
  const repeatCount = options.repeatCount ?? DEFAULT_REPEATS;
  const report = await runEvalSet({
    fixtures,
    executor,
    resourceProfile: profile,
    runArtifactBaseDir: realpathSync(runArtifactBaseDir),
    repeatCount,
    keepWorkingDirs: options.keepWorkingDirs ?? false,
  });

  if (bus) {
    bus.emit("eval-harness.set.completed", {
      fixtureCount: report.aggregate.fixtureCount,
      repeatCount: report.repeatCount,
      passAtK: report.aggregate.passAtK,
      passHatK: report.aggregate.passHatK,
      hostClass: profile.hostClass,
      runArtifactBaseDir: report.runArtifactBaseDir,
      startedAt: report.startedAt,
      completedAt: report.completedAt,
    });
  }

  return {
    ok: true,
    fixtureCount: report.aggregate.fixtureCount,
    repeatCount: report.repeatCount,
    passAtK: report.aggregate.passAtK,
    passHatK: report.aggregate.passHatK,
    runArtifactBaseDir: report.runArtifactBaseDir,
  };
}

export function runEvalCalibration(
  projectDir: string,
  options: EvalCalibrationOptions = {},
): EvalCalibrationResult {
  const windowDays = options.windowDays ?? 7;
  const followUpDays = options.followUpDays ?? 3;
  const thresholdRate = options.thresholdRate ?? DEFAULT_CALIBRATION_THRESHOLD_RATE;
  const minSample = options.minSample ?? DEFAULT_CALIBRATION_MIN_SAMPLE;
  const runsDir = options.runsDir ?? join(projectDir, ".kota", "runs");

  const aggregate = aggregateCalibration(runsDir, {
    windowMs: windowDays * DAY_MS,
    followUpWindowMs: followUpDays * DAY_MS,
  });
  const decision = evaluateCalibrationGate(aggregate, {
    thresholdRate,
    minSample,
  });
  return {
    aggregate: aggregate as unknown as Record<string, unknown>,
    decision: decision as unknown as Record<string, unknown>,
  };
}
