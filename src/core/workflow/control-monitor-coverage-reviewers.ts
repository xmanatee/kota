import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import {
  artifactRef,
  runArtifactRef,
  triggerPayloadLinkedRunIds,
} from "./control-monitor-coverage-readers.js";
import { ASYNC_REVIEW_ARTIFACTS } from "./control-monitor-coverage-types.js";
import type { WorkflowRunMetadata } from "./run-types.js";

export type ReviewerLinks = {
  evidenceRefs: string[];
  responseTimes: number[];
};

export function reviewerLinks(args: {
  scopeRoot: string;
  runDirPath: string;
  metadata: WorkflowRunMetadata;
}): ReviewerLinks {
  const refs: string[] = [];
  const responseTimes: number[] = [];
  for (const artifact of ASYNC_REVIEW_ARTIFACTS) {
    const path = join(args.runDirPath, artifact);
    if (existsSync(path)) refs.push(runArtifactRef(args.scopeRoot, args.runDirPath, artifact));
  }

  const runsDir = join(args.scopeRoot, ".kota", "runs");
  const completedMs = args.metadata.completedAt
    ? Date.parse(args.metadata.completedAt)
    : null;
  if (!existsSync(runsDir)) return { evidenceRefs: refs, responseTimes };

  for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === args.metadata.id) continue;
    const dir = join(runsDir, entry.name);
    const meta = readOptionalJsonFile<WorkflowRunMetadata>(
      join(dir, "metadata.json"),
    );
    if (!meta) continue;
    const triggerPayload = meta.trigger?.payload;
    const linked =
      meta.causedBy?.runId === args.metadata.id ||
      meta.triggeredByRunId === args.metadata.id ||
      (triggerPayload !== undefined &&
        triggerPayloadLinkedRunIds(triggerPayload).includes(args.metadata.id));
    if (!linked) continue;
    const artifact = ASYNC_REVIEW_ARTIFACTS.find((name) => existsSync(join(dir, name)));
    if (!artifact) continue;
    refs.push(artifactRef(args.scopeRoot, join(dir, artifact)));
    if (completedMs !== null) {
      const startedMs = Date.parse(meta.startedAt);
      if (Number.isFinite(startedMs) && startedMs >= completedMs) {
        responseTimes.push(startedMs - completedMs);
      }
    }
  }
  return { evidenceRefs: [...new Set(refs)].sort(), responseTimes };
}

export function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(
    values.reduce((sum, value) => sum + value, 0) / values.length,
  );
}
