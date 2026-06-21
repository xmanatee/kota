
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExecutionProfilePreflightResult, FixtureRun, SkillAblationRun } from "./fixture-run.js";
import type { ObservedObjectiveMetric } from "./objective-metrics.js";
import type { WorkflowExecutionOutcome } from "./runner-types.js";

export function writeSkillAblationRunArtifact(
  runArtifactDir: string,
  payload: {
    run: FixtureRun;
    fixtureId: string;
    workingDir: string;
    executionProfile: ExecutionProfilePreflightResult;
    skillAblation: SkillAblationRun;
    objectiveMetrics: ObservedObjectiveMetric[];
    executionOutcome: WorkflowExecutionOutcome;
  },
): void {
  mkdirSync(runArtifactDir, { recursive: true });
  writeFileSync(
    join(runArtifactDir, "fixture-run.json"),
    JSON.stringify(
      {
        ...payload.run,
        fixture: {
          id: payload.fixtureId,
          mode: "skill-ablation",
          workingDir: payload.workingDir,
        },
        executionProfile: payload.executionProfile,
        execution: payload.executionOutcome,
        skillAblation: payload.skillAblation,
        objectiveMetrics: payload.objectiveMetrics,
      },
      null,
      2,
    ),
  );
}
