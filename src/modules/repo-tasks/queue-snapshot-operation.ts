import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  getRepoTaskQueueSnapshot,
  type RepoTaskQueueSnapshot,
} from "./repo-tasks-domain.js";

export type RepoTaskQueueSnapshotInput = {
  repoRoot: string;
};

export function inspectRepoTaskQueueSnapshot(
  input: RepoTaskQueueSnapshotInput,
): RepoTaskQueueSnapshot {
  return getRepoTaskQueueSnapshot(input.repoRoot);
}

export const repoTaskQueueSnapshotOperation =
  defineWorkflowBlockingOperation<
    RepoTaskQueueSnapshotInput,
    RepoTaskQueueSnapshot
  >(import.meta.url, "inspectRepoTaskQueueSnapshot");
