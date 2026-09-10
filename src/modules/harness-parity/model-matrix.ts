import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentHarness } from "#core/agent-harness/index.js";
import { resolveAgentHarness } from "#core/agent-harness/index.js";
import type { WorkflowExecutor } from "#modules/eval-harness/public-surface.js";
import { resolveHarnessModel } from "#modules/model-clients/harness-model-resolution.js";
import type {
  HarnessParityMatrixOptions,
  HarnessParityMatrixResult,
  HarnessParityMatrixRow,
} from "./client.js";
import type { HarnessParityDeps } from "./harness-parity-operations.js";
import {
  aggregateGroup,
  aggregateMatrix,
  groupRows,
} from "./model-matrix-aggregate.js";
import {
  loadRequestedEvalFixtures,
  resolveEvalResourceProfile,
  runEvalFixturesForSpec,
} from "./model-matrix-eval.js";
import { matrixHarnessOverrides } from "./model-matrix-execution.js";
import { matrixEvalExecutor, preflightMatrixEval, validateMatrixIsolationBackends } from "./model-matrix-isolation.js";
import {
  buildModelSpecs,
  resolveOpenRouterPreflight,
  skipReasonFor,
} from "./model-matrix-models.js";
import { rowFromArtifact, skippedRow } from "./model-matrix-rows.js";
import { buildShadowComparisons } from "./model-matrix-shadow.js";
import { runScenarioAcrossHarnesses } from "./runner.js";
import {
  type LoadedScenario,
  loadAllScenarios,
  loadScenario,
  ScenarioLoadError,
} from "./scenario.js";

function buildOutBaseDir(defaultOutBaseDir: string, override?: string): string {
  if (override) return override;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(defaultOutBaseDir, `model-matrix-${stamp}`);
}

function safePathSegment(value: string): string {
  return (
    value
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "row"
  );
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
): number | null {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) return null;
  return resolved;
}

function loadRequestedScenarios(
  deps: HarnessParityDeps,
  ids: readonly string[] | undefined,
):
  | { ok: true; scenarios: LoadedScenario[] }
  | { ok: false; result: HarnessParityMatrixResult } {
  try {
    const scenarios =
      ids && ids.length > 0
        ? ids.map((id) => loadScenario(deps.scenariosRoot, id))
        : loadAllScenarios(deps.scenariosRoot);
    return { ok: true, scenarios };
  } catch (err) {
    if (err instanceof ScenarioLoadError) {
      return {
        ok: false,
        result: {
          ok: false,
          reason: "scenarios_load_error",
          message: `${err.message} (scenarioDir=${err.scenarioDir})`,
        },
      };
    }
    throw err;
  }
}

function resolveRepeats(
  options: HarnessParityMatrixOptions,
): HarnessParityMatrixResult | number {
  const repeats = positiveInteger(options.repeats, 1);
  if (repeats === null) {
    return {
      ok: false,
      reason: "invalid_repeats",
      message: `repeats must be a positive integer, got "${options.repeats}".`,
    };
  }
  if (options.maxTurns !== undefined) {
    const maxTurns = positiveInteger(options.maxTurns, options.maxTurns);
    if (maxTurns === null) {
      return {
        ok: false,
        reason: "invalid_max_turns",
        message: `maxTurns must be a positive integer, got "${options.maxTurns}".`,
      };
    }
  }
  return repeats;
}

export async function runHarnessParityModelMatrix(
  deps: HarnessParityDeps,
  options: HarnessParityMatrixOptions = {},
): Promise<HarnessParityMatrixResult> {
  const repeats = resolveRepeats(options);
  if (typeof repeats !== "number") return repeats;

  const shouldLoadHarnessParityScenarios =
    options.evalFixtures === undefined || options.scenarios !== undefined;
  const loaded = shouldLoadHarnessParityScenarios
    ? loadRequestedScenarios(deps, options.scenarios)
    : { ok: true as const, scenarios: [] };
  if (!loaded.ok) return loaded.result;
  const evalFixtures = loadRequestedEvalFixtures(deps, options.evalFixtures);
  if (!evalFixtures.ok) return evalFixtures.result;
  if (loaded.scenarios.length === 0 && evalFixtures.fixtures.length === 0) {
    return {
      ok: false,
      reason: "no_scenarios",
      message: `No matrix targets to run under "${deps.scenariosRoot}" or "${deps.evalFixturesRoot}".`,
    };
  }

  let specs: ReturnType<typeof buildModelSpecs>;
  try {
    specs = buildModelSpecs(deps.config, options);
  } catch (error) {
    return { ok: false, reason: "invalid_harness_pair", message: (error as Error).message };
  }
  if (!Array.isArray(specs)) return specs;
  const executions: Array<{ spec: (typeof specs)[number]; harness: AgentHarness; evalExecutor?: WorkflowExecutor }> = [];
  try {
    for (const spec of specs) {
      const names = options.harnesses?.length ? options.harnesses : [spec.defaultHarness];
      const failures: string[] = [];
      const pairs: typeof executions = [];
      for (const name of new Set(names)) {
        const harness = resolveAgentHarness(name);
        try {
          const model = resolveHarnessModel(harness, spec.model, spec.executionProvider);
          matrixHarnessOverrides(harness, spec, options.effort);
          pairs.push({ spec: { ...spec, model }, harness });
        } catch (error) {
          failures.push((error as Error).message);
        }
      }
      if (pairs.length === 0) throw new Error(failures.join(" "));
      executions.push(...pairs);
    }
  } catch (error) {
    return { ok: false, reason: "invalid_harness_pair", message: (error as Error).message };
  }
  const openRouterPreflight = resolveOpenRouterPreflight(deps.scopeRoot);
  const evalResourceProfile =
    evalFixtures.fixtures.length > 0
      ? resolveEvalResourceProfile(options)
      : null;
  if (evalResourceProfile !== null && "ok" in evalResourceProfile) {
    return evalResourceProfile;
  }

  const outBaseDir = buildOutBaseDir(deps.defaultOutBaseDir, options.outDir);
  mkdirSync(outBaseDir, { recursive: true });
  if (evalResourceProfile !== null) {
    try {
      const backends = options.evalIsolationBackends === undefined
        ? undefined : validateMatrixIsolationBackends(options.evalIsolationBackends);
      // Resolve the whole matrix before any row can consume inference.
      for (const execution of executions) {
        if (skipReasonFor(execution.spec, openRouterPreflight) !== null) continue;
        execution.evalExecutor = matrixEvalExecutor({ deps, ...execution, backends });
      }
    } catch (error) {
      return { ok: false, reason: "invalid_eval_isolation", message: (error as Error).message };
    }
    const failures: string[] = [];
    for (const [index, execution] of executions.entries()) {
      if (skipReasonFor(execution.spec, openRouterPreflight) !== null) continue;
      const failure = preflightMatrixEval({
        ...execution, executor: execution.evalExecutor!, profile: evalResourceProfile, outBaseDir, index,
      });
      if (failure !== null) failures.push(failure);
    }
    if (failures.length > 0) {
      return { ok: false, reason: "eval_preflight_failed", message: failures.join("\n") };
    }
  }
  const rows: HarnessParityMatrixRow[] = [];

  for (const { spec, harness, evalExecutor } of executions) {
    const harnessOverrides = matrixHarnessOverrides(harness, spec, options.effort);
    const skipReason = skipReasonFor(spec, openRouterPreflight);
    if (evalFixtures.fixtures.length > 0 && evalResourceProfile !== null) {
      rows.push(
        ...(await runEvalFixturesForSpec({
          deps,
          options,
          spec,
          harnessName: harness.name,
          openRouterPreflight,
          fixtures: evalFixtures.fixtures,
          outBaseDir,
          repeats,
          requestedProfile: evalResourceProfile,
          executor: evalExecutor!,
        })),
      );
    }
    for (const scenario of loaded.scenarios) {
      for (let repeatIndex = 0; repeatIndex < repeats; repeatIndex += 1) {
        const rowId = [
          safePathSegment(spec.role),
          safePathSegment(spec.label),
          safePathSegment(harness.name),
          safePathSegment(scenario.spec.id),
          `r${repeatIndex + 1}`,
        ].join("-");
        if (skipReason !== null) {
          rows.push(
            skippedRow({
              spec,
              harnessName: harness.name,
              scenarioId: scenario.spec.id,
              repeatIndex,
              repeatCount: repeats,
              rowId,
              skipReason,
            }),
          );
          continue;
        }
        const artifacts = await runScenarioAcrossHarnesses({
          scenario,
          harnesses: [harness],
          callOptions: {
            model: spec.model,
            scopeRoot: deps.scopeRoot,
            modelOutputTokenLimits: deps.config.modelOutputTokenLimits,
            harnessOverrides,
            ...(options.maxTurns !== undefined
              ? { maxTurns: options.maxTurns }
              : {}),
            effort: harnessOverrides === undefined ? options.effort : null,
          },
          outBaseDir: join(outBaseDir, "rows", rowId),
          ...(options.keepWorkingDir !== undefined
            ? { keepWorkingDir: options.keepWorkingDir }
            : {}),
        });
        rows.push(
          rowFromArtifact({
            spec,
            harnessName: harness.name,
            scenarioId: scenario.spec.id,
            repeatIndex,
            repeatCount: repeats,
            rowId,
            artifact: artifacts[0]!,
          }),
        );
      }
    }
  }

  const matrixGroups = groupRows(rows);
  const groups = matrixGroups.map(aggregateGroup);
  const aggregate = aggregateMatrix(groups);
  const shadowComparisons = buildShadowComparisons(matrixGroups, groups);
  const reportPath = join(outBaseDir, "model-matrix-report.json");
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        scenarios: loaded.scenarios.map((scenario) => scenario.spec.id),
        evalFixtures: evalFixtures.fixtures.map((fixture) => fixture.spec.id),
        harnesses: [...new Set(executions.map(({ harness }) => harness.name))],
        repeats,
        ...(evalResourceProfile !== null
          ? { evalResourceProfile }
          : {}),
        ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
        ...(options.effort !== undefined ? { effort: options.effort } : {}),
        openRouterPreflight,
        rows,
        groups,
        aggregate,
        shadowComparisons,
      },
      null,
      2,
    ),
  );

  return {
    ok: true,
    outBaseDir,
    reportPath,
    rows,
    groups,
    aggregate,
    shadowComparisons,
  };
}
