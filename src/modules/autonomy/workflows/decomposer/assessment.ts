import { labeledPredicate } from "#core/workflow/run-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import {
  assessDecomposerFailureOperation,
  type DecomposerAssessment,
} from "./blocking-operations.js";

export type { DecomposerAssessment } from "./blocking-operations.js";

export const assessFailure = typedCodeStep<DecomposerAssessment>({
  id: "assess-failure",
  type: "code",
  exposeOutputToAgent: true,
  exposedOutputTrust: "untrusted",
  validate: (raw) =>
    expectStructuredOutput<DecomposerAssessment>(raw, [
      "reason",
      "failedRunId",
      "failedRunDir",
      "failureKind",
      "shouldDecompose",
    ]),
  run: ({ projectDir, trigger, runBlocking }) =>
    runBlocking(assessDecomposerFailureOperation, {
      projectDir,
      triggerEvent: trigger.event,
      triggerPayload: trigger.payload,
    }),
});

export const shouldRunDecompose = labeledPredicate(
  "no-decompose-target",
  (ctx) => assessFailure.outputRequired(ctx).shouldDecompose,
);

export function decompositionTargetTaskId(
  ctx: Parameters<typeof assessFailure.outputRequired>[0],
): string {
  const assessment = assessFailure.outputRequired(ctx);
  if (assessment.shouldDecompose) return assessment.taskId;
  throw new Error("decompose step ran without an active task target");
}
