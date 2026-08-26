import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  type FanOutConsolidationArtifact,
  seedFanOutConsolidationTasks,
} from "#modules/autonomy/fan-out-consolidation.js";

export type FanOutDetectionInspection = {
  dirty: boolean;
  artifact: FanOutConsolidationArtifact;
  touchedDisk: boolean;
};

export function detectAndSeedFanOutInWorker(input: {
  workspaceRoot: string;
  nowIso: string;
}): FanOutDetectionInspection {
  const worktree = getRepoWorktreeStatus(input.workspaceRoot);
  const dirty = worktree.available && worktree.dirty;
  const now = new Date(input.nowIso);
  if (dirty) {
    return {
      dirty,
      touchedDisk: false,
      artifact: {
        generatedAt: now.toISOString(),
        detection: { windowMs: 0, minSurfaces: 0, nowMs: now.getTime() },
        batches: [],
        proposals: [],
        applied: [],
      },
    };
  }
  const result = seedFanOutConsolidationTasks({
    workspaceRoot: input.workspaceRoot,
    nowMs: now.getTime(),
    nowIso: now.toISOString(),
  });
  return {
    dirty,
    touchedDisk: result.touchedDisk,
    artifact: result.artifact,
  };
}

export const detectAndSeedFanOutOperation = defineWorkflowBlockingOperation<
  { workspaceRoot: string; nowIso: string },
  FanOutDetectionInspection
>(import.meta.url, "detectAndSeedFanOutInWorker");
