/**
 * Shared logic for `kota harness-parity list` / `kota harness-parity run`.
 *
 * Both the CLI subcommands (via the local-client handler) and the daemon
 * HTTP routes route through these functions so the two transports cannot
 * diverge in behavior.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentHarness } from "#core/agent-harness/index.js";
import { listAgentHarnessNames, resolveAgentHarness } from "#core/agent-harness/index.js";
import type { KotaConfig } from "#core/config/config.js";
import { resolveActivePresetFromConfig } from "#core/model/preset.js";
import type {
  HarnessParityListResult,
  HarnessParityRunOptions,
  HarnessParityRunResult,
} from "./client.js";
import { runScenarioAcrossHarnesses } from "./runner.js";
import {
  type LoadedScenario,
  loadAllScenarios,
  loadScenario,
  ScenarioLoadError,
} from "./scenario.js";

export type HarnessParityDeps = {
  /** Root directory containing per-scenario subdirectories. */
  scenariosRoot: string;
  /** Default base directory for paired artifacts when `outDir` is omitted. */
  defaultOutBaseDir: string;
  /**
   * Active KOTA config used to resolve the default model from the active
   * preset when `options.model` is omitted. The CLI / daemon route passes the
   * loaded config; tests pass a minimal `{}` and rely on the shipped default
   * preset.
   */
  config: KotaConfig;
};

function buildOutBaseDir(defaultOutBaseDir: string, override?: string): string {
  if (override) return override;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(defaultOutBaseDir, `harness-parity-${stamp}`);
}

export function listHarnessParityScenarios(
  deps: HarnessParityDeps,
): HarnessParityListResult {
  const scenarios = loadAllScenarios(deps.scenariosRoot);
  return {
    scenarios: scenarios.map((s) => ({
      id: s.spec.id,
      description: s.spec.description,
    })),
  };
}

function loadRequestedScenarios(
  deps: HarnessParityDeps,
  ids: readonly string[] | undefined,
): { ok: true; scenarios: LoadedScenario[] } | { ok: false; result: HarnessParityRunResult } {
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

export async function runHarnessParity(
  deps: HarnessParityDeps,
  options?: HarnessParityRunOptions,
): Promise<HarnessParityRunResult> {
  const loaded = loadRequestedScenarios(deps, options?.scenarios);
  if (!loaded.ok) return loaded.result;
  if (loaded.scenarios.length === 0) {
    return {
      ok: false,
      reason: "no_scenarios",
      message: `No scenarios to run under "${deps.scenariosRoot}".`,
    };
  }

  if (options?.maxTurns !== undefined) {
    if (!Number.isFinite(options.maxTurns) || options.maxTurns < 1) {
      return {
        ok: false,
        reason: "invalid_max_turns",
        message: `maxTurns must be a positive integer, got "${options.maxTurns}".`,
      };
    }
  }

  const harnessNames =
    options?.harnesses && options.harnesses.length > 0
      ? options.harnesses
      : listAgentHarnessNames();
  if (harnessNames.length === 0) {
    return {
      ok: false,
      reason: "no_harnesses",
      message:
        "No agent harnesses are registered; load a harness module (e.g. claude-agent-harness) before running harness-parity.",
    };
  }
  const harnesses: AgentHarness[] = harnessNames.map((name) => resolveAgentHarness(name));

  const outBaseDir = buildOutBaseDir(deps.defaultOutBaseDir, options?.outDir);
  mkdirSync(outBaseDir, { recursive: true });
  const model =
    options?.model ?? resolveActivePresetFromConfig(deps.config).defaultModel;

  const summaries: HarnessParityRunResult = {
    ok: true,
    outBaseDir,
    artifacts: [],
  };

  for (const scenario of loaded.scenarios) {
    const artifacts = await runScenarioAcrossHarnesses({
      scenario,
      harnesses,
      callOptions: {
        model,
        ...(options?.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
      },
      outBaseDir,
      ...(options?.keepWorkingDir !== undefined
        ? { keepWorkingDir: options.keepWorkingDir }
        : {}),
    });
    for (const artifact of artifacts) {
      summaries.artifacts.push({
        scenarioId: artifact.scenarioId,
        harnessName: artifact.harnessName,
        passed: artifact.verification.passed,
        isError: artifact.isError,
        turns: artifact.turns,
        changedFiles: [...artifact.changedFiles],
        artifactDir: artifact.artifactDir,
      });
    }
  }

  return summaries;
}
