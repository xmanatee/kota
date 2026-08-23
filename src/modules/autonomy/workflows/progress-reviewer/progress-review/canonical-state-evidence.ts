import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { OwnerDecisionRecord } from "#core/daemon/owner-decision-store.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { listAutonomyIssues } from "#modules/autonomy/autonomy-issue-projection.js";
import {
  listRecoveryClaims,
  listRecoveryWorktrees,
} from "#modules/autonomy/workflow-state-recovery-claims.js";
import { getRepoTaskQueueSnapshot } from "#modules/repo-tasks/repo-tasks-domain.js";
import type { ProgressReviewSemanticInput } from "../semantic-input.js";
import { sourceEvidenceId, sourceSummary } from "./trigger-target.js";
import type {
  ProgressReviewDirectorySource,
  ProgressReviewEvidenceRef,
} from "./types.js";

function stateRef(args: {
  source: ProgressReviewDirectorySource;
  id: string;
  summary: string;
  path: string;
}): ProgressReviewEvidenceRef {
  return {
    id: sourceEvidenceId(args.source, `state:${args.id}`),
    kind: "state",
    summary: sourceSummary(args.source, args.summary),
    path: args.path,
  };
}

function ownerDecisionCounts(projectDir: string): string {
  const directory = join(projectDir, ".kota", "owner-decisions");
  if (!existsSync(directory)) return "none";
  const counts = new Map<string, number>();
  for (const file of readdirSync(directory).filter((entry) => entry.endsWith(".json"))) {
    const record = readOptionalJsonFile<OwnerDecisionRecord>(join(directory, file));
    if (!record) continue;
    counts.set(record.status, (counts.get(record.status) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${status}=${count}`)
    .join(" ") || "none";
}

export function listCanonicalProgressState(args: {
  source: ProgressReviewDirectorySource;
  semanticInput: ProgressReviewSemanticInput;
}): ProgressReviewEvidenceRef[] {
  const queue = getRepoTaskQueueSnapshot(args.source.projectDir);
  const issues = listAutonomyIssues(args.source.projectDir);
  const issueCounts = new Map<string, number>();
  for (const issue of issues) {
    issueCounts.set(issue.status, (issueCounts.get(issue.status) ?? 0) + 1);
  }
  const recoveryClaims = listRecoveryClaims(args.source.projectDir);
  const recoveryWorktrees = listRecoveryWorktrees(args.source.projectDir);
  const staleWorktrees = recoveryWorktrees.filter(
    (worktree) =>
      worktree.state === "stale" || worktree.recommendedAction.kind === "cleanup",
  );
  return [
    stateRef({
      source: args.source,
      id: "queue",
      path: "data/tasks/",
      summary:
        `Canonical queue open=${queue.openCount} actionable=${queue.actionableCount} ` +
        `promotableBacklog=${queue.promotableBacklogCount} ` +
        `dependencyBlocked=${queue.dependencyBlockedTasks.length}`,
    }),
    stateRef({
      source: args.source,
      id: "autonomy-issues",
      path: ".kota/autonomy-issues/projection.json",
      summary:
        "Durable autonomy issues " +
        ([...issueCounts.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([status, count]) => `${status}=${count}`)
          .join(" ") || "none"),
    }),
    stateRef({
      source: args.source,
      id: "recovery",
      path: ".kota/worktrees/",
      summary:
        `Recovery projection claims=${recoveryClaims.length} ` +
        `worktrees=${recoveryWorktrees.length} staleWorktrees=${staleWorktrees.length}`,
    }),
    stateRef({
      source: args.source,
      id: "owner-decisions",
      path: ".kota/owner-decisions/",
      summary: `Owner decisions ${ownerDecisionCounts(args.source.projectDir)}`,
    }),
    ...args.semanticInput.evidenceRefs.map((path, index) =>
      stateRef({
        source: args.source,
        id: `semantic-input:${index}`,
        path,
        summary:
          `Semantic boundary ${args.semanticInput.boundary} revision ` +
          `${args.semanticInput.inputRevision ?? "explicit"} cites ${path}`,
      })
    ),
  ];
}
