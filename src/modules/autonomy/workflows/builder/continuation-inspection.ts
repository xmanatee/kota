import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { validateWorkflowRunId } from "#core/workflow/run-io.js";
import type { WorkflowRepairContinuationPacket } from "#core/workflow/run-types.js";
import { listClaimableQueueTaskCandidates } from "#modules/autonomy/task-claims.js";
import {
  compareAutonomyTasks,
  describeAutonomyTaskRank,
} from "#modules/autonomy/task-ranking.js";
import {
  listFullRepoTasks,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  builderQueueRevision,
  builderTaskContract,
  classifyBuilderRepairTrajectory,
  continuationBoundaryReasons,
  continuationEvidenceKey,
  countNumberedCriteria,
  countVerifiedNumberedCriteria,
  inspectContinuationDiff,
  sortedContinuationIds,
} from "./continuation-evidence.js";
import {
  BUILDER_CONTINUATION_ARTIFACT,
  type BuilderContinuationArtifact,
  type BuilderContinuationInspection,
  type BuilderContinuationInspectionInput,
} from "./continuation-types.js";

const MAX_PACKET_CONTRACT_CHARS = 6_000;

export { classifyBuilderRepairTrajectory } from "./continuation-evidence.js";

export function inspectBuilderContinuationInWorker(
  input: BuilderContinuationInspectionInput,
): BuilderContinuationInspection {
  const artifactPath = join(input.runDir, BUILDER_CONTINUATION_ARTIFACT);
  const tasks = listFullRepoTasks(input.projectDir, [
    "backlog",
    "ready",
    "doing",
    "blocked",
  ]);
  const task = tasks.find((candidate) => candidate.id === input.taskId);
  if (task === undefined) {
    throw new Error(`Claimed builder task ${input.taskId} is unavailable`);
  }
  const frontier = listClaimableQueueTaskCandidates(input.projectDir).find(
    (candidate) => candidate.id !== task.id,
  );
  const higherPriorityTask =
    frontier !== undefined && compareAutonomyTasks(frontier, task) < 0
      ? frontier
      : null;
  const diff = inspectContinuationDiff(input.workspaceDir);
  const classification = classifyBuilderRepairTrajectory(input.continuation);
  const reasons = continuationBoundaryReasons({
    continuation: input.continuation,
    classification,
    diff,
    higherPriorityTask,
  });
  const contract = builderTaskContract(task);
  if (reasons.length === 0) {
    return { packet: null, taskContract: contract, diffContent: diff.content, artifactPath };
  }
  const declaredCriteria = countNumberedCriteria(
    join(input.agentRunDir, "success-criteria.txt"),
  );
  const verifiedCriteriaPath = join(
    input.agentRunDir,
    "success-criteria-verified.txt",
  );
  const addressedCriteria = countNumberedCriteria(verifiedCriteriaPath);
  const verifiedCriteria = countVerifiedNumberedCriteria(verifiedCriteriaPath);
  const queueTasks = listClaimableQueueTaskCandidates(input.projectDir);
  const currentQueueRevision = builderQueueRevision(queueTasks);
  const boundaryKey = continuationEvidenceKey({
    reasons,
  });
  const priorArtifacts = [
    artifactPath,
    ...input.priorRunIds.map((runId) => {
      validateWorkflowRunId(runId, "Builder continuation lineage");
      return join(
        input.projectDir,
        ".kota",
        "runs",
        runId,
        BUILDER_CONTINUATION_ARTIFACT,
      );
    }),
  ].map((path) => readOptionalJsonFile<BuilderContinuationArtifact>(path));
  if (
    priorArtifacts.some((artifact) =>
      artifact?.decisions.some(
        (decision) => decision.evidenceKey === boundaryKey,
      ),
    )
  ) {
    return { packet: null, taskContract: contract, diffContent: diff.content, artifactPath };
  }
  const packet: WorkflowRepairContinuationPacket = {
    schemaVersion: 1,
    boundaryKey,
    boundaryReasons: reasons,
    attempt: input.continuation.attempt,
    failureIds: sortedContinuationIds(input.continuation.failureIds),
    warningIds: sortedContinuationIds(input.continuation.warningIds),
    progressKey: input.continuation.progressKey,
    trajectory: {
      classification,
      attempts: input.continuation.attempt,
      failureIdsByAttempt: [
        ...input.continuation.repairIterations.map((item) =>
          sortedContinuationIds(item.failureIds),
        ),
        sortedContinuationIds(input.continuation.failureIds),
      ],
    },
    context: [
      {
        label: "task",
        value: `${task.id}; ${describeAutonomyTaskRank(task, 0)}`,
      },
      {
        label: "task-contract",
        value: contract.slice(0, MAX_PACKET_CONTRACT_CHARS),
      },
      {
        label: "diff",
        value: `${diff.files.length} files; +${diff.insertions}/-${diff.deletions}; ${diff.files.join(", ")}`,
      },
      {
        label: "queue",
        value: `revision ${currentQueueRevision}; frontier ${frontier?.id ?? "none"}; higher-priority ${higherPriorityTask?.id ?? "none"}`,
      },
      {
        label: "success-criteria",
        value:
          `${verifiedCriteria}/${declaredCriteria} verified; ` +
          `${addressedCriteria}/${declaredCriteria} addressed`,
      },
    ],
  };
  return { packet, taskContract: contract, diffContent: diff.content, artifactPath };
}

export const inspectBuilderContinuationOperation =
  defineWorkflowBlockingOperation<
    BuilderContinuationInspectionInput,
    BuilderContinuationInspection
  >(import.meta.url, "inspectBuilderContinuationInWorker");
