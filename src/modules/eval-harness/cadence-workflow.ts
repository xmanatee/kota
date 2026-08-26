/**
 * Weekly cadence workflow that runs the eval harness set, compares the fresh
 * aggregate against the persisted baseline, emits a typed regression event
 * when the gate fires, and rolls the baseline forward on accepted outcomes.
 *
 * The cadence is the one surface where baseline persistence applies. The
 * CLI and HTTP entry points are unchanged — a caller that passes its own
 * baseline there still owns the comparison.
 */

import { isAbsolute } from "node:path";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  EVAL_HARNESS_CADENCE_BASELINE_STATE_KEY,
  type PersistedBaseline,
} from "./baseline-state.js";
import {
  type EvalHarnessCadenceResult,
  evalHarnessCadenceOperation,
} from "./cadence-operation.js";
import { evalHarnessSetCompleted } from "./events.js";
import type { SubprocessIsolationBackend } from "./subprocess-executor.js";

export const EVAL_HARNESS_CADENCE_CONTAINER_EXECUTABLE_ENV =
  "KOTA_EVAL_HARNESS_CADENCE_CONTAINER_EXECUTABLE";
export const EVAL_HARNESS_CADENCE_CONTAINER_IMAGE_ENV =
  "KOTA_EVAL_HARNESS_CADENCE_CONTAINER_IMAGE";
export const EVAL_HARNESS_CADENCE_CONTAINER_KOTA_BINARY_PATH_ENV =
  "KOTA_EVAL_HARNESS_CADENCE_CONTAINER_KOTA_BINARY_PATH";

export function isCadenceIsolationConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const values = [
    env[EVAL_HARNESS_CADENCE_CONTAINER_EXECUTABLE_ENV],
    env[EVAL_HARNESS_CADENCE_CONTAINER_IMAGE_ENV],
    env[EVAL_HARNESS_CADENCE_CONTAINER_KOTA_BINARY_PATH_ENV],
  ];
  if (values.every((value) => value === undefined)) return false;
  resolveCadenceIsolationBackend(env);
  return true;
}

export function resolveCadenceIsolationBackend(
  env: NodeJS.ProcessEnv = process.env,
): Extract<SubprocessIsolationBackend, { kind: "container" }> {
  const executable = env[EVAL_HARNESS_CADENCE_CONTAINER_EXECUTABLE_ENV];
  const image = env[EVAL_HARNESS_CADENCE_CONTAINER_IMAGE_ENV];
  const kotaBinaryPath =
    env[EVAL_HARNESS_CADENCE_CONTAINER_KOTA_BINARY_PATH_ENV];
  if (
    executable === undefined ||
    image === undefined ||
    kotaBinaryPath === undefined ||
    executable.length === 0 ||
    image.length === 0 ||
    kotaBinaryPath.length === 0
  ) {
    throw new Error(
      `${EVAL_HARNESS_CADENCE_CONTAINER_EXECUTABLE_ENV}, ${EVAL_HARNESS_CADENCE_CONTAINER_IMAGE_ENV}, and ${EVAL_HARNESS_CADENCE_CONTAINER_KOTA_BINARY_PATH_ENV} must be set together.`,
    );
  }
  if (!isAbsolute(kotaBinaryPath)) {
    throw new Error(
      `${EVAL_HARNESS_CADENCE_CONTAINER_KOTA_BINARY_PATH_ENV} must be an absolute container path.`,
    );
  }
  return { kind: "container", executable, image, kotaBinaryPath };
}

export const runHarness = typedCodeStep<EvalHarnessCadenceResult>({
  id: "run-harness",
  type: "code",
  timeoutMs: null,
  idleTimeoutMs: 5 * 60 * 1000,
  validate: (raw) =>
    expectStructuredOutput<EvalHarnessCadenceResult>(raw, [
      "fixtureCount",
      "repeatCount",
      "passAtK",
      "passHatK",
      "fixtureDiagnostics",
      "runArtifactBaseDir",
      "assessmentStatus",
    ]),
  run: async (ctx) => {
    const baseline = ctx.state.read<PersistedBaseline>(
      EVAL_HARNESS_CADENCE_BASELINE_STATE_KEY,
    );
    const output = await ctx.runBlocking(evalHarnessCadenceOperation, {
      workspaceRoot: ctx.workspaceRoot,
      runDirPath: ctx.workflow.runDirPath,
      isolationBackend: resolveCadenceIsolationBackend(),
      priorBaseline: baseline.value,
    });
    if (output.baselineToRecord !== null) {
      ctx.state.compareAndSet(
        EVAL_HARNESS_CADENCE_BASELINE_STATE_KEY,
        baseline.revision,
        output.baselineToRecord,
      );
    }
    if (output.regressionEvent !== null) {
      ctx.emit("eval-harness.regression.detected", output.regressionEvent, {
        delivery: "on-run-success",
        stepId: "run-harness:regression",
      });
    }
    ctx.emit(evalHarnessSetCompleted.name, output.completedEvent, {
      delivery: "on-run-success",
      stepId: "run-harness:completed",
    });
    return output.result;
  },
});

const evalHarnessCadence: WorkflowDefinitionInput = {
  name: "eval-harness-cadence",
  description:
    "Run the autonomy eval harness fixture set on a weekly cadence and emit aggregate telemetry.",
  enabled: isCadenceIsolationConfigured(),
  defaultAutonomyMode: "autonomous",
  repository: "read",
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
