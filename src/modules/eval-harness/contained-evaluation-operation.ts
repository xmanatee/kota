import {
  defineWorkflowBlockingOperation,
  type WorkflowBlockingOperationContext,
} from "#core/workflow/blocking-operation.js";
import { runAgyModelEvaluationSuite } from "./agy-model-evaluation.js";
import { requireAgyModelEvaluationIsolation } from "./agy-model-evaluation-isolation.js";
import type { AgyModelEvaluationResult } from "./agy-model-evaluation-types.js";
import type { EvalRunOptions, EvalRunResult } from "./client.js";
import type { ContainedEvaluationRequest } from "./contained-evaluation.js";
import { runEvalHarness } from "./eval-operations.js";
import type { PreparedEvalRunExecution } from "./eval-run-execution.js";

type Input = {
  workspaceRoot: string;
  request: Exclude<ContainedEvaluationRequest, { operation: "inspect" }>;
  options: EvalRunOptions;
  artifactDir: string;
  env?: NodeJS.ProcessEnv;
  prepared: PreparedEvalRunExecution;
};
type Output = EvalRunResult | AgyModelEvaluationResult;
export async function runContainedEvaluation(
  input: Input,
  context: WorkflowBlockingOperationContext,
): Promise<Output> {
  context.signal.throwIfAborted();
  const execution = {
    ...context,
    artifactDir: input.artifactDir,
    env: input.env,
    prepared: input.prepared,
  };
  return input.request.operation === "run"
    ? runEvalHarness(
        input.workspaceRoot,
        {
          ...input.options,
          fixtureIds: [...new Set(input.request.fixtureIds)],
        },
        undefined,
        execution,
      )
    : runAgyModelEvaluationSuite(
        input.workspaceRoot,
        {
          ...input.options,
          isolationBackend: requireAgyModelEvaluationIsolation(
            input.options.isolationBackend,
          ),
          candidates: [...new Set(input.request.candidates)],
        },
        {},
        execution,
      );
}
export const containedEvaluationOperation = defineWorkflowBlockingOperation<
  Input,
  Output
>(import.meta.url, "runContainedEvaluation");
