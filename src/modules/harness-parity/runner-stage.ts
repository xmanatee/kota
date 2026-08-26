import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentEffort,
  AgentHarness,
  AgentHarnessRunOptions,
  HarnessCapabilitySnapshot,
  KotaAgentMessage,
} from "#core/agent-harness/index.js";
import {
  runAgentHarness,
  UNKNOWN_AGENT_USAGE,
} from "#core/agent-harness/index.js";
import { TRACE_TAIL_LIMIT } from "./runner-constants.js";
import {
  writeContextRetrievalDiagnosticsArtifact,
} from "./runner-context-retrieval-artifacts.js";
import {
  capturePreviewArtifacts,
  computeDiff,
  createCollectingWriter,
  runVerification,
  tail,
} from "./runner-files.js";
import { buildTraceSummary } from "./runner-trace-summary.js";
import { writeTrajectoryArtifacts } from "./runner-trajectory-artifacts.js";
import type {
  HarnessParityCallOptions,
  HarnessParityStageArtifact,
  HarnessParityStageRunRecord,
} from "./runner-types.js";
import type { LoadedScenario, ScenarioStageSpec } from "./scenario.js";

/**
 * Run one prompt stage through one harness against an already-materialized
 * working tree. Staged scenarios call this repeatedly with the same working
 * directory so each release-note prompt inherits earlier edits.
 */
export async function runScenarioStageOnHarness(args: {
  scenario: LoadedScenario;
  stage: ScenarioStageSpec;
  harness: AgentHarness;
  callOptions: HarnessParityCallOptions;
  artifactDir: string;
  capability: HarnessCapabilitySnapshot;
  workingDir: string;
  effort: AgentEffort;
}): Promise<HarnessParityStageRunRecord> {
  const { scenario, stage, harness, callOptions, artifactDir, capability } = args;
  mkdirSync(artifactDir, { recursive: true });
  const writer = createCollectingWriter();
  const trajectoryMessages: KotaAgentMessage[] = [];
  const startedAt = new Date();
  const startMs = startedAt.getTime();

  let runError: Error | null = null;
  let runResult: Awaited<ReturnType<typeof runAgentHarness>> | null = null;
  try {
    const runOptions: AgentHarnessRunOptions = {
      prompt: stage.prompt,
      model: callOptions.model,
      cwd: args.workingDir,
      effort: args.effort,
      ...(callOptions.systemPrompt !== undefined
        ? { systemPrompt: callOptions.systemPrompt }
        : {}),
      ...(callOptions.maxTurns !== undefined
        ? { maxTurns: callOptions.maxTurns }
        : {}),
      ...(capability.emitsAgentMessageStream
        ? {
            onMessage(message) {
              trajectoryMessages.push(message);
            },
          }
        : {}),
    };
    runResult = await runAgentHarness(
      harness,
      runOptions,
      writer,
    );
  } catch (err) {
    runError = err instanceof Error ? err : new Error(String(err));
  }

  const durationMs = Date.now() - startMs;
  const { diff, changedFiles } = computeDiff(
    scenario.initialStateDir,
    args.workingDir,
  );
  const verification = runVerification(args.workingDir, stage.verification);
  const previewArtifacts = capturePreviewArtifacts({
    workingDir: args.workingDir,
    artifactDir,
    previewArtifacts: stage.previewArtifacts,
  });

  writeFileSync(join(artifactDir, "prompt.txt"), stage.prompt);
  writeFileSync(join(artifactDir, "diff.patch"), diff);
  writeFileSync(
    join(artifactDir, "verification.json"),
    JSON.stringify(verification, null, 2),
  );
  writeFileSync(
    join(artifactDir, "trace.txt"),
    tail(writer.collected(), TRACE_TAIL_LIMIT),
  );
  const { trajectory, trajectoryDiagnostics } = writeTrajectoryArtifacts({
    artifactDir,
    capability,
    messages: trajectoryMessages,
    changedFiles,
    verification: stage.verification,
  });
  const contextRetrievalDiagnostics = writeContextRetrievalDiagnosticsArtifact({
    artifactDir,
    capability,
    messages: trajectoryMessages,
    stage,
  });

  const artifact: HarnessParityStageArtifact = {
    stageId: stage.id,
    scenarioId: scenario.spec.id,
    harnessName: harness.name,
    model: callOptions.model,
    effort: args.effort,
    startedAt: startedAt.toISOString(),
    durationMs,
    turns: runResult?.turns ?? 0,
    isError: runError !== null || runResult?.isError === true,
    usage: runResult?.usage ?? UNKNOWN_AGENT_USAGE,
    verification,
    capability,
    changedFiles,
    previewArtifacts,
    artifactDir,
    trajectory,
    trajectoryDiagnostics,
    ...(contextRetrievalDiagnostics !== undefined
      ? { contextRetrievalDiagnostics }
      : {}),
    ...(runResult?.subtype !== undefined ? { subtype: runResult.subtype } : {}),
    ...(runResult?.sessionId !== undefined ? { sessionId: runResult.sessionId } : {}),
  };

  writeFileSync(
    join(artifactDir, "run-meta.json"),
    JSON.stringify(
      {
        ...artifact,
        workingDir: args.workingDir,
        error: runError
          ? { message: runError.message, stack: runError.stack }
          : null,
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(artifactDir, "trace-summary.md"),
    buildTraceSummary(artifact, runError, writer.collected()),
  );

  return {
    ...artifact,
    diff,
    runError,
    streamedText: writer.collected(),
  };
}
