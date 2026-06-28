import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentEffort,
  AgentHarness,
  HarnessCapabilitySnapshot,
} from "#core/agent-harness/index.js";
import {
  aggregateContextRetrievalDiagnosticsMetadata,
  CONTEXT_RETRIEVAL_DIAGNOSTICS_ARTIFACT_NAME,
  type ContextRetrievalDiagnosticsMetadata,
} from "./context-retrieval-diagnostics.js";
import { TRACE_TAIL_LIMIT } from "./runner-constants.js";
import { writeStagedContextRetrievalDiagnosticsArtifact } from "./runner-context-retrieval-artifacts.js";
import { tail } from "./runner-files.js";
import { buildStagedTraceSummary } from "./runner-trace-summary.js";
import { writeStagedTrajectoryArtifacts } from "./runner-trajectory-artifacts.js";
import type {
  HarnessParityArtifact,
  HarnessParityCallOptions,
  HarnessParityStageArtifact,
  HarnessParityStagedSummary,
  HarnessParityStageRunRecord,
  VerificationResult,
} from "./runner-types.js";
import type { LoadedScenario, ScenarioStageSpec } from "./scenario.js";
import {
  aggregateTrajectoryDiagnosticsMetadata,
  TRAJECTORY_DIAGNOSTICS_ARTIFACT_NAME,
} from "./trajectory-diagnostics.js";

function buildAggregateVerification(
  stageRecords: readonly HarnessParityStageRunRecord[],
): VerificationResult {
  const passed = stageRecords.every((stage) => stage.verification.passed);
  return {
    command: stageRecords
      .map((stage) => `${stage.stageId}: ${stage.verification.command}`)
      .join(" && "),
    timeoutMs: stageRecords.reduce(
      (sum, stage) => sum + stage.verification.timeoutMs,
      0,
    ),
    passed,
    exitStatus: passed ? 0 : 1,
    timedOut: stageRecords.some((stage) => stage.verification.timedOut),
    output: tail(
      stageRecords
        .map(
          (stage) =>
            `[${stage.stageId}] ${stage.verification.passed ? "pass" : "fail"} exit=${stage.verification.exitStatus ?? "null"}${stage.verification.timedOut ? " timeout" : ""}\n${stage.verification.output}`,
        )
        .join("\n\n"),
      TRACE_TAIL_LIMIT,
    ),
  };
}

function buildStagedSummary(
  mode: "single" | "staged",
  stages: readonly HarnessParityStageArtifact[],
): HarnessParityStagedSummary {
  return {
    mode,
    passed: stages.every((stage) => stage.verification.passed),
    stageCount: stages.length,
    stages: stages.map((stage) => ({
      stageId: stage.stageId,
      verificationPassed: stage.verification.passed,
      changedFiles: stage.changedFiles,
      isError: stage.isError,
      turns: stage.turns,
      durationMs: stage.durationMs,
      artifactDir: stage.artifactDir,
      previewArtifacts: stage.previewArtifacts,
      trajectory: stage.trajectory,
      trajectoryDiagnostics: stage.trajectoryDiagnostics,
      ...(stage.contextRetrievalDiagnostics !== undefined
        ? { contextRetrievalDiagnostics: stage.contextRetrievalDiagnostics }
        : {}),
    })),
  };
}

function sumOptionalNumber(
  stages: readonly HarnessParityStageArtifact[],
  getValue: (stage: HarnessParityStageArtifact) => number | undefined,
): number | undefined {
  const values = stages
    .map((stage) => getValue(stage))
    .filter((value): value is number => value !== undefined);
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0);
}

function buildStagedPromptText(stages: readonly ScenarioStageSpec[]): string {
  return `${stages
    .map((stage) => `## ${stage.id}\n\n${stage.prompt}`)
    .join("\n\n")}\n`;
}

function aggregateContextRetrieval(
  stages: readonly HarnessParityStageArtifact[],
  artifactDir: string,
): ContextRetrievalDiagnosticsMetadata | undefined {
  return aggregateContextRetrievalDiagnosticsMetadata(
    stages
      .map((stage) => stage.contextRetrievalDiagnostics)
      .filter(
        (diagnostics): diagnostics is ContextRetrievalDiagnosticsMetadata =>
          diagnostics !== undefined,
      ),
    join(artifactDir, CONTEXT_RETRIEVAL_DIAGNOSTICS_ARTIFACT_NAME),
  );
}

export function buildHarnessArtifact(args: {
  scenario: LoadedScenario;
  harness: AgentHarness;
  callOptions: HarnessParityCallOptions;
  artifactDir: string;
  workingDir: string;
  capability: HarnessCapabilitySnapshot;
  effort: AgentEffort;
  stageRecords: readonly HarnessParityStageRunRecord[];
  startedAt: Date;
  durationMs: number;
}): HarnessParityArtifact {
  const stages: readonly HarnessParityStageArtifact[] = args.stageRecords.map(
    ({ diff: _diff, runError: _runError, streamedText: _streamedText, ...stage }) =>
      stage,
  );
  const finalStage = stages[stages.length - 1]!;
  const verification =
    args.scenario.spec.stageMode === "single"
      ? finalStage.verification
      : buildAggregateVerification(args.stageRecords);
  const stagedSummary = buildStagedSummary(args.scenario.spec.stageMode, stages);
  const trajectoryDiagnostics =
    args.scenario.spec.stageMode === "single"
      ? finalStage.trajectoryDiagnostics
      : aggregateTrajectoryDiagnosticsMetadata(
          stages.map((stage) => stage.trajectoryDiagnostics),
          join(args.artifactDir, TRAJECTORY_DIAGNOSTICS_ARTIFACT_NAME),
        );
  const contextRetrievalDiagnostics =
    args.scenario.spec.stageMode === "single"
      ? finalStage.contextRetrievalDiagnostics
      : aggregateContextRetrieval(stages, args.artifactDir);

  return {
    scenarioId: args.scenario.spec.id,
    harnessName: args.harness.name,
    model: args.callOptions.model,
    effort: args.effort,
    startedAt: args.startedAt.toISOString(),
    durationMs: args.durationMs,
    turns: stages.reduce((sum, stage) => sum + stage.turns, 0),
    isError: stages.some((stage) => stage.isError),
    verification,
    capability: args.capability,
    changedFiles: finalStage.changedFiles,
    previewArtifacts: finalStage.previewArtifacts,
    artifactDir: args.artifactDir,
    trajectory: finalStage.trajectory,
    trajectoryDiagnostics,
    ...(contextRetrievalDiagnostics !== undefined
      ? { contextRetrievalDiagnostics }
      : {}),
    stageMode: args.scenario.spec.stageMode,
    stages,
    stagedSummary,
    ...(sumOptionalNumber(stages, (stage) => stage.inputTokens) !== undefined
      ? { inputTokens: sumOptionalNumber(stages, (stage) => stage.inputTokens) }
      : {}),
    ...(sumOptionalNumber(stages, (stage) => stage.outputTokens) !== undefined
      ? { outputTokens: sumOptionalNumber(stages, (stage) => stage.outputTokens) }
      : {}),
    ...(sumOptionalNumber(stages, (stage) => stage.totalCostUsd) !== undefined
      ? {
          totalCostUsd: sumOptionalNumber(
            stages,
            (stage) => stage.totalCostUsd,
          ),
        }
      : {}),
    ...(args.scenario.spec.stageMode === "single" && finalStage.subtype !== undefined
      ? { subtype: finalStage.subtype }
      : {}),
    ...(args.scenario.spec.stageMode === "single" &&
    finalStage.sessionId !== undefined
      ? { sessionId: finalStage.sessionId }
      : {}),
  };
}

export function writeHarnessArtifact(args: {
  artifact: HarnessParityArtifact;
  scenario: LoadedScenario;
  workingDir: string;
  stageRecords: readonly HarnessParityStageRunRecord[];
}): void {
  const { artifact, scenario, stageRecords } = args;
  const finalStage = stageRecords[stageRecords.length - 1]!;
  const firstRunError =
    stageRecords.find((stage) => stage.runError !== null)?.runError ?? null;
  if (scenario.spec.stageMode === "staged") {
    writeFileSync(
      join(artifact.artifactDir, "prompt.txt"),
      buildStagedPromptText(scenario.spec.stages),
    );
    writeFileSync(join(artifact.artifactDir, "diff.patch"), finalStage.diff);
    writeFileSync(
      join(artifact.artifactDir, "verification.json"),
      JSON.stringify(artifact.verification, null, 2),
    );
    writeFileSync(
      join(artifact.artifactDir, "trace.txt"),
      tail(
        stageRecords
          .map((stage) => `## ${stage.stageId}\n${stage.streamedText}`)
          .join("\n\n"),
        TRACE_TAIL_LIMIT,
      ),
    );
    writeStagedTrajectoryArtifacts(artifact);
    writeStagedContextRetrievalDiagnosticsArtifact(artifact);
  }

  writeFileSync(
    join(artifact.artifactDir, "run-meta.json"),
    JSON.stringify(
      {
        ...artifact,
        workingDir: args.workingDir,
        error: firstRunError
          ? { message: firstRunError.message, stack: firstRunError.stack }
          : null,
        stages: stageRecords.map(
          ({ diff: _diff, runError, streamedText: _streamedText, ...stage }) => ({
            ...stage,
            error: runError
              ? { message: runError.message, stack: runError.stack }
              : null,
          }),
        ),
      },
      null,
      2,
    ),
  );

  if (scenario.spec.stageMode === "staged") {
    writeFileSync(
      join(artifact.artifactDir, "trace-summary.md"),
      buildStagedTraceSummary(artifact),
    );
  }
}
