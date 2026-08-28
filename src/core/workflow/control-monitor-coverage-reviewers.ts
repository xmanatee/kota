import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  artifactRef,
  runArtifactRef,
  triggerPayloadLinkedRunIds,
} from "./control-monitor-coverage-readers.js";
import { ASYNC_REVIEW_ARTIFACTS } from "./control-monitor-coverage-types.js";
import { readWorkflowRunMetadataFile } from "./run-metadata.js";
import type { WorkflowRunMetadata } from "./run-types.js";

export type ReviewerResponseSummary = {
  observations: number;
  min: number | null;
  max: number | null;
  average: number | null;
};

export type ReviewerLinks = {
  evidenceRefs: string[];
  responseTimes: number[];
  priorResponse?: ReviewerResponseSummary;
};

export function reviewerLinks(args: {
  scopeRoot: string;
  runDirPath: string;
  metadata: WorkflowRunMetadata;
  linkedReviewers?: ReviewerLinks;
  discoverLinkedReviewers?: boolean;
}): ReviewerLinks {
  const refs: string[] = args.discoverLinkedReviewers
    ? []
    : [...(args.linkedReviewers?.evidenceRefs ?? [])];
  const responseTimes: number[] = args.discoverLinkedReviewers
    ? []
    : [...(args.linkedReviewers?.responseTimes ?? [])];
  for (const artifact of ASYNC_REVIEW_ARTIFACTS) {
    const path = join(args.runDirPath, artifact);
    if (existsSync(path)) refs.push(runArtifactRef(args.scopeRoot, args.runDirPath, artifact));
  }

  if (args.discoverLinkedReviewers) {
    const runsDir = join(args.scopeRoot, ".kota", "runs");
    const completedMs = args.metadata.completedAt
      ? Date.parse(args.metadata.completedAt)
      : null;
    if (existsSync(runsDir)) {
      for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === args.metadata.id) continue;
        const dir = join(runsDir, entry.name);
        const metadata = readWorkflowRunMetadataFile(join(dir, "metadata.json"));
        if (!metadata) continue;
        const linked =
          metadata.causedBy?.runId === args.metadata.id ||
          metadata.triggeredByRunId === args.metadata.id ||
          triggerPayloadLinkedRunIds(metadata.trigger.payload).includes(args.metadata.id);
        if (!linked) continue;
        const artifact = ASYNC_REVIEW_ARTIFACTS.find((name) =>
          existsSync(join(dir, name))
        );
        if (!artifact) continue;
        refs.push(artifactRef(args.scopeRoot, join(dir, artifact)));
        if (completedMs !== null) {
          const startedMs = Date.parse(metadata.startedAt);
          if (Number.isFinite(startedMs) && startedMs >= completedMs) {
            responseTimes.push(startedMs - completedMs);
          }
        }
      }
    }
  }

  return {
    evidenceRefs: [...new Set(refs)].sort(),
    responseTimes,
    ...(args.discoverLinkedReviewers || args.linkedReviewers?.priorResponse === undefined
      ? {}
      : { priorResponse: args.linkedReviewers.priorResponse }),
  };
}
