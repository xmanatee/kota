import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { validateWorkflowRunId } from "#core/workflow/run-io.js";
import { labeledPredicate, type WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import {
  type BuilderDecompositionFailureKind,
  classifyBuilderFailureForDecomposition,
} from "#modules/autonomy/builder-failure-classification.js";
import {
  type DecompositionSource,
  resolveDecompositionOwnership,
} from "./assessment-ownership.js";

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

type ResolvedSource = DecompositionSource & {
  /** True when the trigger gives us no usable source context (non-builder recovery). */
  skip: boolean;
};

function resolveSourceRun(
  triggerEvent: string,
  payload: WorkflowRunTrigger["payload"],
): ResolvedSource {
  if (triggerEvent === "runtime.recovered") {
    const sourceWorkflow = payload.sourceWorkflow;
    if (sourceWorkflow !== "builder") {
      return { runId: "", runDir: "", skip: true };
    }
    const sourceRunId = payload.sourceRunId;
    if (typeof sourceRunId !== "string") {
      throw new Error(
        "Decomposer recovery trigger payload must include sourceRunId when sourceWorkflow is builder",
      );
    }
    const runId = validateWorkflowRunId(sourceRunId, "Decomposer recovery source");
    return {
      runId,
      runDir: join(".kota", "runs", runId),
      skip: false,
    };
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
  return { runId: validatedRunId, runDir: canonicalRunDir, skip: false };
}

function assertBuilderFailureMetadata(
  metadata: WorkflowRunMetadata,
  source: ResolvedSource,
): void {
  if (
    metadata.id !== source.runId ||
    metadata.workflow !== "builder" ||
    metadata.status !== "failed" ||
    metadata.runDir !== source.runDir
  ) {
    throw new Error(
      `Decomposer source metadata must identify failed builder run ${source.runId} at ${source.runDir}`,
    );
  }
}

function buildAssessment(
  projectDir: string,
  triggerEvent: string,
  triggerPayload: WorkflowRunTrigger["payload"],
): DecomposerAssessment {
  const source = resolveSourceRun(triggerEvent, triggerPayload);

  if (source.skip) {
    return {
      shouldDecompose: false,
      reason: "Recovery source was not builder — nothing for decomposer to do",
      failedRunId: "",
      failedRunDir: "",
      failureKind: null,
    };
  }

  const metadataPath = join(projectDir, source.runDir, "metadata.json");
  const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);

  if (!metadata) {
    return {
      shouldDecompose: false,
      reason: `Could not read run metadata at ${metadataPath}`,
      failedRunId: source.runId,
      failedRunDir: source.runDir,
      failureKind: null,
    };
  }
  assertBuilderFailureMetadata(metadata, source);

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

  const ownership = resolveDecompositionOwnership(projectDir, source);
  if (ownership.kind !== "owned-task") {
    return {
      shouldDecompose: false,
      reason:
        ownership.kind === "missing-artifact"
          ? "Builder run has no claimed task artifact to rescope"
          : ownership.reason,
      failedRunId: source.runId,
      failedRunDir: source.runDir,
      failureKind,
    };
  }
  const task = ownership.task;

  return {
    shouldDecompose: true,
    reason: `Builder ${failureKind === "timeout" ? "timed out" : "exhausted repair"} on ${task.id} — rescoping`,
    failedRunId: source.runId,
    failedRunDir: source.runDir,
    taskId: task.id,
    taskPath: task.path,
    taskMarkdown: task.markdown,
    failureKind,
  };
}

export function assertDecompositionOwnership(
  projectDir: string,
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
  const ownership = resolveDecompositionOwnership(projectDir, {
    runId,
    runDir: canonicalRunDir,
  });
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
  run: ({ projectDir, trigger }) =>
    buildAssessment(projectDir, trigger.event, trigger.payload),
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
