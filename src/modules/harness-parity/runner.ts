/**
 * Execute a coding-task scenario against a single `AgentHarness` and capture
 * paired artifacts for operator review. Reuses the existing `runAgentHarness`
 * entry point the CLI already calls; there is no second benchmarking path.
 *
 * Artifacts land under `<outBaseDir>/<harnessName>/` so every harness result
 * for a scenario is side-by-side in one directory.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildHarnessCapabilityArtifact,
  buildHarnessCapabilitySnapshot,
} from "#core/agent-harness/index.js";
import { buildHarnessArtifact, writeHarnessArtifact } from "./runner-artifact-assembly.js";
import { DEFAULT_EFFORT } from "./runner-constants.js";
import { materializeWorkingDir } from "./runner-files.js";
import { runScenarioStageOnHarness } from "./runner-stage.js";
import type {
  HarnessParityArtifact,
  HarnessParityRunParams,
  HarnessParityStageRunRecord,
} from "./runner-types.js";

export type * from "./runner-types.js";

/**
 * Run one scenario through one harness. The caller is responsible for
 * resolving the harness from the registry; this function stays oblivious to
 * which adapters exist so it can be reused by both CLI and tests.
 */
export async function runScenarioOnHarness(
  params: HarnessParityRunParams,
): Promise<HarnessParityArtifact> {
  const { scenario, harness, callOptions } = params;
  const artifactDir = join(params.outBaseDir, harness.name);
  mkdirSync(artifactDir, { recursive: true });

  const effort = callOptions.effort ?? DEFAULT_EFFORT;
  const capability = buildHarnessCapabilitySnapshot(harness, {
    model: callOptions.model,
    effort,
  });
  const materialized = materializeWorkingDir(scenario);
  const { workingDir } = materialized;
  const runStartedAt = new Date();
  const runStartMs = runStartedAt.getTime();
  const stageRecords: HarnessParityStageRunRecord[] = [];
  try {
    for (const stage of scenario.spec.stages) {
      const stageDir =
        scenario.spec.stageMode === "single"
          ? artifactDir
          : join(artifactDir, "stages", stage.id);
      stageRecords.push(
        await runScenarioStageOnHarness({
          scenario,
          stage,
          harness,
          callOptions,
          artifactDir: stageDir,
          capability,
          workingDir,
          effort,
        }),
      );
    }

    const artifact = buildHarnessArtifact({
      scenario,
      harness,
      callOptions,
      effort,
      artifactDir,
      workingDir,
      capability,
      stageRecords,
      startedAt: runStartedAt,
      durationMs: Date.now() - runStartMs,
    });
    writeHarnessArtifact({
      artifact,
      scenario,
      workingDir,
      stageRecords,
    });

    return artifact;
  } finally {
    if (!params.keepWorkingDir) {
      rmSync(materialized.cleanupDir, { recursive: true, force: true });
    }
  }
}

/**
 * Run one scenario across every harness in `harnesses`, in order. Writes a
 * combined `parity.json` under `outBaseDir/<scenario.id>/` summarizing the
 * paired outcomes and returns every per-harness artifact.
 */
export async function runScenarioAcrossHarnesses(params: {
  scenario: HarnessParityRunParams["scenario"];
  harnesses: readonly HarnessParityRunParams["harness"][];
  callOptions: HarnessParityRunParams["callOptions"];
  outBaseDir: string;
  keepWorkingDir?: boolean;
}): Promise<HarnessParityArtifact[]> {
  const scenarioBaseDir = join(params.outBaseDir, params.scenario.spec.id);
  mkdirSync(scenarioBaseDir, { recursive: true });

  const artifacts: HarnessParityArtifact[] = [];
  for (const harness of params.harnesses) {
    const artifact = await runScenarioOnHarness({
      scenario: params.scenario,
      harness,
      callOptions: params.callOptions,
      outBaseDir: scenarioBaseDir,
      ...(params.keepWorkingDir !== undefined
        ? { keepWorkingDir: params.keepWorkingDir }
        : {}),
    });
    artifacts.push(artifact);
  }

  writeFileSync(
    join(scenarioBaseDir, "parity.json"),
    JSON.stringify(
      {
        scenarioId: params.scenario.spec.id,
        stageMode: params.scenario.spec.stageMode,
        model: params.callOptions.model,
        artifacts: artifacts.map((a) => ({
          harnessName: a.harnessName,
          effort: a.effort,
          durationMs: a.durationMs,
          turns: a.turns,
          verificationPassed: a.verification.passed,
          changedFiles: a.changedFiles,
          isError: a.isError,
          capability: buildHarnessCapabilityArtifact(a.capability),
          trajectory: a.trajectory,
          trajectoryDiagnostics: a.trajectoryDiagnostics,
          ...(a.contextRetrievalDiagnostics !== undefined
            ? { contextRetrievalDiagnostics: a.contextRetrievalDiagnostics }
            : {}),
          stagedSummary: a.stagedSummary,
          previewArtifacts: a.previewArtifacts,
          totalCostUsd: a.totalCostUsd,
          inputTokens: a.inputTokens,
          outputTokens: a.outputTokens,
          artifactDir: a.artifactDir,
        })),
      },
      null,
      2,
    ),
  );

  return artifacts;
}
