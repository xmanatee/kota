/**
 * Shared list/run/calibration logic for the `evalHarness` namespace.
 *
 * The CLI subcommands and the daemon control routes both reach these
 * helpers so daemon-up and daemon-down operators see the same fixture
 * set, the same run report shape, and the same calibration aggregate.
 */
import { mkdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveAgentHarness } from "#core/agent-harness/index.js";
import { loadConfig } from "#core/config/config.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { resolveActivePresetFromConfig } from "#core/model/preset.js";
import { getCriticPromptHash } from "#modules/autonomy/critic.js";
import {
  aggregateCalibration,
  DEFAULT_CALIBRATION_MIN_SAMPLE,
  DEFAULT_CALIBRATION_THRESHOLD_RATE,
  DEFAULT_PASS_WITH_WARNINGS_MIN_SAMPLE,
  DEFAULT_PASS_WITH_WARNINGS_THRESHOLD_RATE,
  evaluateCalibrationGate,
} from "#modules/autonomy/evaluator-calibration.js";
import { loadBaseline } from "./baseline-store.js";
import type {
  EvalCalibrationOptions,
  EvalCalibrationResult,
  EvalListResult,
  EvalRunOptions,
  EvalRunResult,
} from "./client.js";
import { runEvalSet } from "./eval-set.js";
import { evalHarnessSetCompleted } from "./events.js";
import {
  isMultiRoundFixtureSpec,
  isSkillAblationFixtureSpec,
  loadAllFixtures,
  loadFixture,
  summarizeControlDecisionCoverage,
} from "./fixture.js";
import type { ResourceProfile } from "./fixture-run.js";
import { ObjectiveMetricValidationError } from "./objective-metrics.js";
import {
  type ProviderEgressTaskSubprocessBoundaryRequest,
  providerEgressAuthEnvKeysFor,
} from "./provider-egress.js";
import {
  compareRunConfigurations,
  missingPriorRunConfigurationComparison,
  toRunConfigurationOperatorSummary,
} from "./run-configuration.js";
import {
  createSubprocessExecutor,
  detectHostSubprocessResourceProfile,
  type SubprocessIsolationBackend,
} from "./subprocess-executor.js";

export const DEFAULT_HOST_CLASS = "local-dev";
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

function isolationBackendForRun(options: EvalRunOptions): SubprocessIsolationBackend {
  return options.isolationBackend ?? { kind: "host-subprocess" };
}

function providerEgressTaskBoundaryForRun(
  projectDir: string,
  backend: SubprocessIsolationBackend,
): ProviderEgressTaskSubprocessBoundaryRequest | undefined {
  if (
    backend.kind !== "container" ||
    backend.networkPolicy?.kind !== "provider-egress"
  ) {
    return undefined;
  }
  const activePreset = resolveActivePresetFromConfig(loadConfig(projectDir));
  const harness = resolveAgentHarness(activePreset.harness);
  return {
    agentHarness: activePreset.harness,
    toolControl: harness.toolControl,
  };
}

function providerEgressAuthEnvForRun(
  backend: SubprocessIsolationBackend,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> | undefined {
  if (
    backend.kind !== "container" ||
    backend.networkPolicy?.kind !== "provider-egress"
  ) {
    return undefined;
  }
  const authEnv: Record<string, string> = {};
  for (const key of providerEgressAuthEnvKeysFor(
    backend.networkPolicy.provider,
  )) {
    const value = env[key];
    if (value !== undefined) authEnv[key] = value;
  }
  return Object.keys(authEnv).length > 0 ? authEnv : undefined;
}

export function listEvalFixtures(projectDir: string): EvalListResult {
  const fixtures = loadAllFixtures(fixturesRootFor(projectDir));
  return {
    fixtures: fixtures.map((f) => ({
      id: f.spec.id,
      description: f.spec.description,
      role: f.spec.role,
      workflowName: isMultiRoundFixtureSpec(f.spec)
        ? f.spec.rounds.map((round) => round.workflowName).join(" → ")
        : isSkillAblationFixtureSpec(f.spec)
          ? f.spec.variants.map((variant) => variant.workflowName).join(" <-> ")
        : f.spec.workflowName,
      controlDecisions: [...f.spec.controlDecisions],
      tags: [...(f.spec.tags ?? [])],
    })),
    controlDecisionCoverage: summarizeControlDecisionCoverage(fixtures),
  };
}

function buildProfile(options: EvalRunOptions, defaultHost: string): ResourceProfile {
  const hostClass = options.hostClass ?? defaultHost;
  const detected = detectHostSubprocessResourceProfile(hostClass);
  const cpuAllocationCores =
    options.cpuAllocationCores ?? detected.cpuAllocationCores;
  const cpuKillThresholdCores = options.cpuKillThresholdCores ?? cpuAllocationCores;
  const memoryAllocationMB =
    options.memoryAllocationMB ?? detected.memoryAllocationMB;
  const memoryKillThresholdMB = options.memoryKillThresholdMB ?? memoryAllocationMB;
  return {
    hostClass,
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
  let fixtures: ReturnType<typeof loadAllFixtures>;
  try {
    fixtures = options.fixtureIds && options.fixtureIds.length > 0
      ? options.fixtureIds.map((id) => loadFixture(fixturesRoot, id))
      : loadAllFixtures(fixturesRoot);
  } catch (err) {
    if (err instanceof ObjectiveMetricValidationError) {
      return {
        ok: false,
        reason: "objective_metric_validation",
        validationReason: err.reason,
        message: err.message,
      };
    }
    return {
      ok: false,
      reason: "fixture_provenance",
      message: (err as Error).message,
    };
  }
  if (fixtures.length === 0) {
    return { ok: false, reason: "no_fixtures", message: `No fixtures under "${fixturesRoot}".` };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runArtifactBaseDir = join(evalRunsRootFor(projectDir), stamp);
  mkdirSync(runArtifactBaseDir, { recursive: true });
  const isolationBackend = isolationBackendForRun(options);
  const executor = createSubprocessExecutor({
    kotaBinaryPath: kotaBinaryPathFor(projectDir),
    isolationBackend,
    extraEnv: providerEgressAuthEnvForRun(isolationBackend),
    providerEgressTaskBoundary: providerEgressTaskBoundaryForRun(
      projectDir,
      isolationBackend,
    ),
  });
  const requestedProfile = buildProfile(options, DEFAULT_HOST_CLASS);
  const repeatCount = options.repeatCount ?? DEFAULT_REPEATS;
  let report: Awaited<ReturnType<typeof runEvalSet>>;
  try {
    report = await runEvalSet({
      projectDir,
      fixtures,
      executor,
      requestedProfile,
      runArtifactBaseDir: realpathSync(runArtifactBaseDir),
      repeatCount,
      keepWorkingDirs: options.keepWorkingDirs ?? false,
    });
  } catch (err) {
    if (err instanceof ObjectiveMetricValidationError) {
      return {
        ok: false,
        reason: "objective_metric_validation",
        validationReason: err.reason,
        message: err.message,
      };
    }
    throw err;
  }

  if (bus) {
    const pbus = new ProjectScopedEventBus(bus, deriveDirectoryScopeId(projectDir));
    pbus.emit(evalHarnessSetCompleted, {
      fixtureCount: report.aggregate.fixtureCount,
      repeatCount: report.repeatCount,
      passAtK: report.aggregate.passAtK,
      passHatK: report.aggregate.passHatK,
      fixtureDiagnostics: report.fixtureDiagnostics.aggregate,
      hostClass: report.resourceProfile.hostClass,
      runArtifactBaseDir: report.runArtifactBaseDir,
      runConfigurationFingerprint: report.runConfiguration.fingerprint,
      runConfigurationSummary: report.runConfiguration.summary,
      startedAt: report.startedAt,
      completedAt: report.completedAt,
    });
  }

  const priorBaseline = loadBaseline(projectDir);
  const baselineConfigurationComparison =
    priorBaseline === null
      ? null
      : priorBaseline.runConfiguration === undefined
        ? missingPriorRunConfigurationComparison(report.runConfiguration)
        : compareRunConfigurations(
            priorBaseline.runConfiguration,
            report.runConfiguration,
          );

  return {
    ok: true,
    fixtureCount: report.aggregate.fixtureCount,
    repeatCount: report.repeatCount,
    passAtK: report.aggregate.passAtK,
    passHatK: report.aggregate.passHatK,
    controlDecisionCoverage: report.controlDecisionCoverage,
    objectiveMetrics: [...report.objectiveMetrics],
    codeHealth: report.codeHealth,
    fixtureDiagnostics: report.fixtureDiagnostics,
    runConfiguration: toRunConfigurationOperatorSummary(report.runConfiguration),
    baselineConfigurationComparison,
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
    criticPromptHash: getCriticPromptHash(),
  });
  const decision = evaluateCalibrationGate(aggregate, {
    thresholdRate,
    minSample,
    passWithWarningsThresholdRate: DEFAULT_PASS_WITH_WARNINGS_THRESHOLD_RATE,
    passWithWarningsMinSample: DEFAULT_PASS_WITH_WARNINGS_MIN_SAMPLE,
  });
  return {
    aggregate: aggregate as unknown as Record<string, unknown>,
    decision: decision as unknown as Record<string, unknown>,
  };
}
