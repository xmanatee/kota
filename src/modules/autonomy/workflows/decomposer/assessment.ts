import { join } from "node:path";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { validateWorkflowRunId } from "#core/workflow/run-io.js";
import { readWorkflowRunMetadataFile } from "#core/workflow/run-metadata.js";
import {
  labeledPredicate,
  type WorkflowRunMetadata,
} from "#core/workflow/run-types.js";
import {
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type {
  WorkflowPostReconcileInvariant,
  WorkflowResourceInput,
} from "#core/workflow/types.js";
import {
  type BuilderDecompositionFailureKind,
  classifyBuilderFailureForDecomposition,
} from "#modules/autonomy/builder-failure-classification.js";
import {
  BUILDER_TASK_EVENT,
  readBuilderTaskPayload,
} from "#modules/autonomy/workflows/builder/task-contract.js";
import { resolveDecompositionOwnership } from "./assessment-ownership.js";

export type DecomposerAssessment = {
  reason: string;
  failedRunId: string;
  failedRunDir: string;
  failureKind: BuilderDecompositionFailureKind | null;
} & (
  | { shouldDecompose: false }
  | {
      shouldDecompose: true;
      taskId: string;
      taskPath: string;
      taskMarkdown: string;
    }
);

type ResolvedSource = {
  runId: string;
  runDir: string;
};

function resolveSourceRun(
  triggerEvent: string,
  payload: WorkflowRunTrigger["payload"],
): ResolvedSource {
  if (triggerEvent !== "workflow.completed") {
    throw new Error("Decomposer accepts only workflow.completed triggers");
  }

  const runDir = payload.runDir;
  const runId = payload.runId;
  if (typeof runDir !== "string" || typeof runId !== "string") {
    throw new Error("Decomposer trigger payload must include runDir and runId");
  }
  if (payload.workflow !== "builder" || payload.status !== "failed") {
    throw new Error(
      "Decomposer workflow.completed trigger must identify a failed builder run",
    );
  }
  const validatedRunId = validateWorkflowRunId(runId, "Decomposer trigger");
  const canonicalRunDir = join(".kota", "runs", validatedRunId);
  if (runDir !== canonicalRunDir) {
    throw new Error(
      `Decomposer trigger runDir must equal canonical run directory ${canonicalRunDir}`,
    );
  }
  return { runId: validatedRunId, runDir: canonicalRunDir };
}

function assertBuilderFailureMetadata(
  metadata: WorkflowRunMetadata,
  source: ResolvedSource,
): void {
  if (
    metadata.id !== source.runId ||
    metadata.workflow !== "builder" ||
    metadata.status !== "failed" ||
    metadata.runDir !== source.runDir ||
    metadata.trigger.event !== BUILDER_TASK_EVENT
  ) {
    throw new Error(
      `Decomposer source metadata must identify failed builder run ${source.runId} at ${source.runDir}`,
    );
  }
}

function readSourceMetadata(
  stateDir: string,
  source: ResolvedSource,
): WorkflowRunMetadata | null {
  const metadata = readWorkflowRunMetadataFile(
    join(stateDir, "runs", source.runId, "metadata.json"),
  );
  if (metadata !== null) assertBuilderFailureMetadata(metadata, source);
  return metadata;
}

export function decomposerTaskResources(
  input: WorkflowResourceInput,
): readonly string[] {
  const source = resolveSourceRun(input.trigger.event, input.trigger.payload);
  const metadata = readSourceMetadata(input.stateDir, source);
  if (metadata === null) {
    throw new Error(`Cannot claim decomposition target: metadata for ${source.runId} is missing`);
  }
  return [`task:${readBuilderTaskPayload(metadata.trigger.payload).taskId}`];
}

export const verifyDecomposerTaskContractAfterReconcile: WorkflowPostReconcileInvariant =
  (input) => {
    input.signal.throwIfAborted();
    let source: ResolvedSource;
    try {
      source = resolveSourceRun(input.trigger.event, input.trigger.payload);
    } catch (error) {
      return {
        satisfied: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    const metadata = readSourceMetadata(input.stateDir, source);
    if (metadata === null) {
      return {
        satisfied: false,
        reason: `Decomposer source metadata for ${source.runId} is missing`,
      };
    }
    const ownership = resolveDecompositionOwnership(input.repoRoot, metadata);
    return ownership.kind === "owned-task"
      ? { satisfied: true }
      : { satisfied: false, reason: ownership.reason };
  };

function buildAssessment(
  workspaceRoot: string,
  stateDir: string,
  triggerEvent: string,
  triggerPayload: WorkflowRunTrigger["payload"],
): DecomposerAssessment {
  const source = resolveSourceRun(triggerEvent, triggerPayload);
  const metadataPath = join(stateDir, "runs", source.runId, "metadata.json");
  const metadata = readSourceMetadata(stateDir, source);
  if (!metadata) {
    return {
      shouldDecompose: false,
      reason: `Could not read run metadata at ${metadataPath}`,
      failedRunId: source.runId,
      failedRunDir: source.runDir,
      failureKind: null,
    };
  }
  const failureKind = classifyBuilderFailureForDecomposition(metadata);
  if (failureKind === null) {
    return {
      shouldDecompose: false,
      reason: "Builder failure does not require task rescoping",
      failedRunId: source.runId,
      failedRunDir: source.runDir,
      failureKind: null,
    };
  }

  const ownership = resolveDecompositionOwnership(workspaceRoot, metadata);
  if (ownership.kind !== "owned-task") {
    return {
      shouldDecompose: false,
      reason: ownership.reason,
      failedRunId: source.runId,
      failedRunDir: source.runDir,
      failureKind,
    };
  }
  const task = ownership.task;
  return {
    shouldDecompose: true,
    reason:
      `Builder ${failureKind === "timeout" ? "timed out" : "exhausted repair"} ` +
      `on ${task.id} — rescoping`,
    failedRunId: source.runId,
    failedRunDir: source.runDir,
    taskId: task.id,
    taskPath: task.path,
    taskMarkdown: task.markdown,
    failureKind,
  };
}

export function assertDecompositionOwnership(
  workspaceRoot: string,
  stateDir: string,
  assessment: DecomposerAssessment,
): void {
  if (!assessment.shouldDecompose) {
    throw new Error("Cannot verify decomposition ownership without an active target");
  }
  const runId = validateWorkflowRunId(
    assessment.failedRunId,
    "Decomposer assessment",
  );
  const canonicalRunDir = join(".kota", "runs", runId);
  if (assessment.failedRunDir !== canonicalRunDir) {
    throw new Error(
      `Decomposer assessment runDir must equal canonical run directory ${canonicalRunDir}`,
    );
  }
  const metadata = readWorkflowRunMetadataFile(
    join(stateDir, "runs", runId, "metadata.json"),
  );
  if (metadata === null) {
    throw new Error(`Cannot apply decomposition for ${assessment.taskId}: source metadata is missing`);
  }
  assertBuilderFailureMetadata(metadata, {
    runId,
    runDir: canonicalRunDir,
  });
  const ownership = resolveDecompositionOwnership(workspaceRoot, metadata);
  if (
    ownership.kind !== "owned-task" ||
    ownership.task.id !== assessment.taskId ||
    ownership.task.path !== assessment.taskPath ||
    ownership.task.markdown !== assessment.taskMarkdown
  ) {
    throw new Error(
      `Cannot apply decomposition for ${assessment.taskId}: failed-run ownership changed after assessment`,
    );
  }
}

type DecomposerAssessmentInput = {
  workspaceRoot: string;
  stateDir: string;
  triggerEvent: string;
  triggerPayload: WorkflowRunTrigger["payload"];
};

export function assessDecomposerFailureInWorker(
  input: DecomposerAssessmentInput,
): DecomposerAssessment {
  return buildAssessment(
    input.workspaceRoot,
    input.stateDir,
    input.triggerEvent,
    input.triggerPayload,
  );
}

const assessDecomposerFailureOperation = defineWorkflowBlockingOperation<
  DecomposerAssessmentInput,
  DecomposerAssessment
>(import.meta.url, "assessDecomposerFailureInWorker");

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
  run: ({ workspaceRoot, stateDir, trigger, runBlocking }) =>
    runBlocking(assessDecomposerFailureOperation, {
      workspaceRoot,
      stateDir,
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
