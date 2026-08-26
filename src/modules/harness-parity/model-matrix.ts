import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentHarness } from "#core/agent-harness/index.js";
import {
  listAgentHarnessNames,
  resolveAgentHarness,
} from "#core/agent-harness/index.js";
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

function resolveHarnesses(
  options: HarnessParityMatrixOptions,
): HarnessParityMatrixResult | AgentHarness[] {
  const harnessNames =
    options.harnesses && options.harnesses.length > 0
      ? options.harnesses
      : listAgentHarnessNames();
  if (harnessNames.length === 0) {
    return {
      ok: false,
      reason: "no_harnesses",
      message:
        "No agent harnesses are registered; load a harness module before running a model matrix.",
    };
  }
  return harnessNames.map((name) => resolveAgentHarness(name));
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

  const harnesses =
    loaded.scenarios.length > 0 ? resolveHarnesses(options) : [];
  if (!Array.isArray(harnesses)) return harnesses;
  const specs = buildModelSpecs(deps.config, options);
  if (!Array.isArray(specs)) return specs;
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
  const rows: HarnessParityMatrixRow[] = [];

  for (const spec of specs) {
    const skipReason = skipReasonFor(spec, openRouterPreflight);
    if (evalFixtures.fixtures.length > 0 && evalResourceProfile !== null) {
      rows.push(
        ...(await runEvalFixturesForSpec({
          deps,
          options,
          spec,
          openRouterPreflight,
          fixtures: evalFixtures.fixtures,
          outBaseDir,
          repeats,
          requestedProfile: evalResourceProfile,
        })),
      );
    }
    for (const scenario of loaded.scenarios) {
      for (const harness of harnesses) {
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
              ...(options.maxTurns !== undefined
                ? { maxTurns: options.maxTurns }
                : {}),
              ...(options.effort !== undefined ? { effort: options.effort } : {}),
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
        harnesses: harnesses.map((harness) => harness.name),
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
