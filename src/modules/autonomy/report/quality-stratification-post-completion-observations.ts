import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import type { PostCompletionCorrectiveLink } from "./post-completion-followups.js";
import {
  mergeDimensions,
  sortedUnique,
  sourceRunDimensions,
  taskDimensions,
} from "./quality-stratification-dimensions.js";
import type { QualityRunIndexes } from "./quality-stratification-run-indexes.js";
import type {
  QualityBucket,
  QualityObservation,
} from "./quality-stratification-types.js";

type BuildPostCompletionObservationsInput = {
  tasks: readonly RepoTaskFullRecord[];
};

export function buildPostCompletionQualityObservations(
  input: BuildPostCompletionObservationsInput,
  indexes: QualityRunIndexes,
  links: readonly PostCompletionCorrectiveLink[],
  bucket: QualityBucket,
  startMs: number,
  endMs: number,
): QualityObservation[] {
  const linksByCompletedTaskId = groupLinksByCompletedTaskId(links);
  return input.tasks
    .filter((task) => task.state === "done")
    .filter((task) => {
      const updatedAt = taskUpdatedAtMs(task);
      return updatedAt >= startMs && updatedAt <= endMs;
    })
    .map((task) => {
      const taskLinks = linksByCompletedTaskId.get(task.id) ?? [];
      const linkedSourceRunIds = sortedUnique(
        taskLinks.flatMap((link) => link.sourceRunIds),
      );
      const sourceRunIds = linkedSourceRunIds.length
        ? linkedSourceRunIds
        : indexes.runIdsByTaskId.get(task.id) ?? [];
      const sourceArtifactPaths = sortedUnique(
        taskLinks.flatMap((link) => link.sourceArtifactPaths),
      );
      return {
        signal: "post-completion-follow-up",
        bucket,
        denominator: true,
        numerator: taskLinks.length > 0,
        dimensions: mergeDimensions(
          taskDimensions(task),
          sourceRunDimensions(sourceRunIds, indexes),
          taskLinks.length > 0
            ? {
                reasonFamily: sortedUnique(
                  taskLinks.flatMap((link) => link.reasons),
                ),
              }
            : {},
        ),
        reference: {
          runId: sourceRunIds[0],
          taskId: task.id,
          artifact: sourceArtifactPaths[0],
        },
      };
    });
}

function groupLinksByCompletedTaskId(
  links: readonly PostCompletionCorrectiveLink[],
): Map<string, PostCompletionCorrectiveLink[]> {
  const grouped = new Map<string, PostCompletionCorrectiveLink[]>();
  for (const link of links) {
    const existing = grouped.get(link.completedTaskId) ?? [];
    existing.push(link);
    grouped.set(link.completedTaskId, existing);
  }
  return grouped;
}

function taskUpdatedAtMs(task: RepoTaskFullRecord): number {
  const ms = Date.parse(task.updatedAt);
  return Number.isNaN(ms) ? 0 : ms;
}
