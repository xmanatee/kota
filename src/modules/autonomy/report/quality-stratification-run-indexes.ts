import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import {
  type AutonomyRunDeliveryEvidence,
  readAutonomyRunDeliveryEvidence,
} from "#modules/autonomy/run-delivery-evidence.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";

export type BuildQualityRunIndexesInput = {
  tasks: readonly RepoTaskFullRecord[];
  runs: readonly WorkflowRunMetadata[];
  runsDir: string;
};

export type QualityRunIndexes = {
  taskById: Map<string, RepoTaskFullRecord>;
  runById: Map<string, WorkflowRunMetadata>;
  deliveryByRunId: Map<string, AutonomyRunDeliveryEvidence | null>;
  runIdsByTaskId: Map<string, string[]>;
};

export function buildQualityRunIndexes(
  input: BuildQualityRunIndexesInput,
): QualityRunIndexes {
  const taskById = new Map(input.tasks.map((task) => [task.id, task]));
  const runById = new Map(input.runs.map((run) => [run.id, run]));
  const deliveryByRunId = new Map<string, AutonomyRunDeliveryEvidence | null>();
  const runIdsByTaskId = new Map<string, string[]>();

  for (const run of input.runs) {
    const delivery = readAutonomyRunDeliveryEvidence(input.runsDir, run);
    deliveryByRunId.set(run.id, delivery);
    if (!delivery?.taskId) continue;

    const existing = runIdsByTaskId.get(delivery.taskId) ?? [];
    existing.push(run.id);
    runIdsByTaskId.set(delivery.taskId, existing);
  }

  return { taskById, runById, deliveryByRunId, runIdsByTaskId };
}
