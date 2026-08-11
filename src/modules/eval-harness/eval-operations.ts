/**
 * Shared list/run/calibration logic for the `evalHarness` namespace.
 *
 * The CLI subcommands and the daemon control routes both reach these
 * helpers so daemon-up and daemon-down operators see the same fixture
 * set, the same run report shape, and the same calibration aggregate.
 */
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { loadBaseline } from "./baseline-store.js";
import type {
  EvalListResult,
  EvalRunOptions,
  EvalRunResult,
} from "./client.js";
import { toEvalComponentAttributionOperatorSummary } from "./eval-attribution.js";
import { createEvalRunExecution } from "./eval-run-execution.js";
import { runEvalSet } from "./eval-set.js";
import { evalHarnessSetCompleted } from "./events.js";
import {
  isMultiRoundFixtureSpec,
  isSkillAblationFixtureSpec,
  loadAllFixtures,
  loadFixture,
  summarizeControlDecisionCoverage,
} from "./fixture.js";
import { ObjectiveMetricValidationError } from "./objective-metrics.js";
import {
  compareRunConfigurations,
  missingPriorRunConfigurationComparison,
  toRunConfigurationOperatorSummary,
} from "./run-configuration.js";

export { runEvalCalibration } from "./eval-calibration-operation.js";

const DEFAULT_REPEATS = 3;

export function fixturesRootFor(projectDir: string): string {
  return join(projectDir, "src/modules/eval-harness/fixtures");
}

export function evalRunsRootFor(projectDir: string): string {
  return join(projectDir, ".kota/eval-runs");
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
  const { executor, requestedProfile } = createEvalRunExecution(
    projectDir,
    options,
  );
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
