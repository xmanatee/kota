/**
 * Weekly cadence workflow that runs the eval harness set and emits the
 * aggregate telemetry event. The workflow's only step is a code step that
 * reuses the same subprocess executor the CLI and HTTP route use — the
 * harness has one execution path, not three.
 *
 * The workflow writes `ran-at.json` to its run directory with the aggregate
 * numbers, so operators can trace regressions back through the normal
 * workflow-run surfaces.
 */

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { typedCodeStep } from "#core/workflow/types.js";
import { runEvalSet } from "./eval-set.js";
import { loadAllFixtures } from "./fixture.js";
import type { ResourceProfile } from "./fixture-run.js";
import { createSubprocessExecutor } from "./subprocess-executor.js";

type CadenceResult = {
  fixtureCount: number;
  repeatCount: number;
  passAtK: number;
  passHatK: number;
  runArtifactBaseDir: string;
};

const CADENCE_PROFILE: ResourceProfile = {
  hostClass: "autonomy-cadence",
  cpuAllocationCores: 2,
  cpuKillThresholdCores: 2,
  memoryAllocationMB: 4096,
  memoryKillThresholdMB: 4096,
};

const CADENCE_REPEAT_COUNT = 3;

const runHarness = typedCodeStep<CadenceResult>({
  id: "run-harness",
  type: "code",
  run: async ({ projectDir, workflow, emit }) => {
    const fixturesRoot = join(projectDir, "src/modules/eval-harness/fixtures");
    const fixtures = loadAllFixtures(fixturesRoot);
    if (fixtures.length === 0) {
      throw new Error(
        `eval-harness cadence has no fixtures under "${fixturesRoot}". ` +
          "Add at least one fixture before enabling the cadence workflow.",
      );
    }
    const executor = createSubprocessExecutor({
      kotaBinaryPath: resolve(join(projectDir, "bin/kota.mjs")),
    });
    const runArtifactBaseDir = join(workflow.runDirPath, "eval-runs");
    const report = await runEvalSet({
      fixtures,
      executor,
      resourceProfile: CADENCE_PROFILE,
      runArtifactBaseDir,
      repeatCount: CADENCE_REPEAT_COUNT,
    });
    writeFileSync(
      join(workflow.runDirPath, "ran-at.json"),
      JSON.stringify(
        {
          fixtureCount: report.aggregate.fixtureCount,
          repeatCount: report.repeatCount,
          passAtK: report.aggregate.passAtK,
          passHatK: report.aggregate.passHatK,
          resourceProfile: CADENCE_PROFILE,
          startedAt: report.startedAt,
          completedAt: report.completedAt,
        },
        null,
        2,
      ),
    );
    emit("eval-harness.set.completed", {
      fixtureCount: report.aggregate.fixtureCount,
      repeatCount: report.repeatCount,
      passAtK: report.aggregate.passAtK,
      passHatK: report.aggregate.passHatK,
      hostClass: CADENCE_PROFILE.hostClass,
      runArtifactBaseDir: report.runArtifactBaseDir,
      startedAt: report.startedAt,
      completedAt: report.completedAt,
    });
    return {
      fixtureCount: report.aggregate.fixtureCount,
      repeatCount: report.repeatCount,
      passAtK: report.aggregate.passAtK,
      passHatK: report.aggregate.passHatK,
      runArtifactBaseDir: report.runArtifactBaseDir,
    };
  },
});

const evalHarnessCadence: WorkflowDefinitionInput = {
  name: "eval-harness-cadence",
  description:
    "Run the autonomy eval harness fixture set on a weekly cadence and emit aggregate telemetry.",
  defaultAutonomyMode: "autonomous",
  triggers: [
    {
      // Sunday 07:00 local — off-hours so a long run does not clash with
      // interactive autonomy; operators can adjust per deployment.
      schedule: "0 7 * * 0",
    },
  ],
  steps: [runHarness],
};

export default evalHarnessCadence;
