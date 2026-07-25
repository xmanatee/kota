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
import {
  PRESET_ENV_VAR,
  resolveActivePresetFromConfig,
} from "#core/model/preset.js";
import { loadBaseline } from "./baseline-store.js";
import type {
  EvalListResult,
  EvalRunOptions,
  EvalRunResult,
} from "./client.js";
import { toEvalComponentAttributionOperatorSummary } from "./eval-attribution.js";
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

export { runEvalCalibration } from "./eval-calibration-operation.js";

export const DEFAULT_HOST_CLASS = "local-dev";
const DEFAULT_REPEATS = 3;

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

function envForKeys(
  keys: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> | undefined {
  const authEnv: Record<string, string> = {};
  for (const key of keys) {
    const value = env[key];
    if (value !== undefined) authEnv[key] = value;
  }
  return Object.keys(authEnv).length > 0 ? authEnv : undefined;
}

function providerEgressAuthEnvForRun(
  backend: SubprocessIsolationBackend,
  env: NodeJS.ProcessEnv,
): Record<string, string> | undefined {
  if (
    backend.kind !== "container" ||
    backend.networkPolicy?.kind !== "provider-egress"
  ) {
    return undefined;
  }
  return envForKeys(
    providerEgressAuthEnvKeysFor(backend.networkPolicy.provider),
    env,
  );
}

function isolatedHostAuthEnvForRun(
  activePreset: ReturnType<typeof resolveActivePresetFromConfig>,
  backend: SubprocessIsolationBackend,
  env: NodeJS.ProcessEnv,
): Readonly<Record<string, string>> {
  if (backend.kind !== "host-subprocess" || activePreset.authEnv.length > 0) {
    return {};
  }
  const harness = resolveAgentHarness(activePreset.harness);
  return harness.resolveIsolatedHostAuthEnv?.(env) ?? {};
}

export function executorExtraEnvForRun(
  projectDir: string,
  backend: SubprocessIsolationBackend,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const activePreset = resolveActivePresetFromConfig(loadConfig(projectDir), env);
  return {
    [PRESET_ENV_VAR]: activePreset.id,
    ...(envForKeys(activePreset.authEnv, env) ?? {}),
    ...isolatedHostAuthEnvForRun(activePreset, backend, env),
    ...(providerEgressAuthEnvForRun(backend, env) ?? {}),
  };
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
    extraEnv: executorExtraEnvForRun(projectDir, isolationBackend),
    providerEgressTaskBoundary: providerEgressTaskBoundaryForRun(
      projectDir,
      isolationBackend,
    ),
  });
  const requestedProfile = buildProfile(options, DEFAULT_HOST_CLASS);
  const repeatCount = options.repeatCount ?? DEFAULT_REPEATS;
  const priorBaseline = loadBaseline(projectDir);
  let report: Awaited<ReturnType<typeof runEvalSet>>;
  try {
    report = await runEvalSet({
      projectDir,
      fixtures,
      executor,
      requestedProfile,
      runArtifactBaseDir: realpathSync(runArtifactBaseDir),
      repeatCount,
      priorBaseline,
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
    componentAttribution: toEvalComponentAttributionOperatorSummary(
      report.componentAttribution,
    ),
    baselineConfigurationComparison,
    runArtifactBaseDir: report.runArtifactBaseDir,
  };
}
