import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type KotaAgentMessage,
  resolveAgentHarness,
  type TrajectoryDiagnosticsMetadata,
} from "#core/agent-harness/index.js";
import type { ToolCallSummaryEntry } from "./run-types.js";
import type { WorkflowStep } from "./step-types.js";
import {
  readAgentTrajectoryDiagnosticsCapabilityArtifact,
  writeAgentTrajectoryDiagnosticsArtifactFromCapability,
} from "./steps/step-executor-agent-trajectory-diagnostics.js";

type TelemetryArtifact = {
  tools: Record<string, { calls: number; totalMs: number }>;
};

export function readToolCallSummary(
  stepId: string,
  runDir: string,
  projectDir: string,
  log: (message: string) => void,
): ToolCallSummaryEntry[] | undefined {
  const path = join(
    resolve(projectDir, runDir),
    "steps",
    `${stepId}.tool-telemetry.json`,
  );
  if (!existsSync(path)) return undefined;
  try {
    const artifact = JSON.parse(readFileSync(path, "utf-8")) as TelemetryArtifact;
    const entries = Object.entries(artifact.tools ?? {});
    if (entries.length === 0) return undefined;
    return entries
      .sort((a, b) => b[1].calls - a[1].calls)
      .map(([tool, summary]) => ({
        tool,
        count: summary.calls,
        totalMs: summary.totalMs,
      }));
  } catch (error) {
    log(
      `Tool telemetry summary for step "${stepId}" could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}

export function writeFailedAgentTrajectoryDiagnostics(args: {
  step: WorkflowStep;
  runDir: string;
  projectDir: string;
  messages: readonly KotaAgentMessage[];
  log: (message: string) => void;
}): TrajectoryDiagnosticsMetadata | undefined {
  const { step, runDir, projectDir, messages, log } = args;
  if (step.type !== "agent" || step.validate !== undefined) return undefined;
  const artifactPath = join(
    resolve(projectDir, runDir),
    "steps",
    `${step.id}.trajectory-diagnostics.json`,
  );
  if (existsSync(artifactPath)) return undefined;
  try {
    const capability =
      readAgentTrajectoryDiagnosticsCapabilityArtifact({
        stepId: step.id,
        runDir,
        projectDir,
      }) ?? {
        emitsAgentMessageStream: resolveAgentHarness(step.harness)
          .emitsAgentMessageStream,
      };
    return writeAgentTrajectoryDiagnosticsArtifactFromCapability({
      stepId: step.id,
      runDir,
      projectDir,
      capability,
      messages,
      changedFiles: [],
    });
  } catch (error) {
    log(
      `Trajectory diagnostics for failed step "${step.id}" could not be written: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}
