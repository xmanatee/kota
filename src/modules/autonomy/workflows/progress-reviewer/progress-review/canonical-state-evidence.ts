import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { readRunOperationalProjection } from "#core/workflow/run-operational-projection.js";
import type { AutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.js";
import { observeOwnerDecisions } from "#modules/autonomy/owner-decision-observation.js";
import { inspectRepoWorkSupply, resolveRepoWorkSupplyInput } from "#modules/repo-tasks/work-supply.js";
import type { ProgressReviewSemanticInput } from "../semantic-input.js";
import { summarizeSystemicRuns } from "../systemic-evidence.js";
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

function ownerDecisionCounts(stateDir: string, scopeId: string): string {
  const counts = new Map<string, number>();
  for (const record of observeOwnerDecisions(stateDir, scopeId)) {
    counts.set(record.status, (counts.get(record.status) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${status}=${count}`)
    .join(" ") || "none";
}

function semanticEvidenceSummary(source: ProgressReviewDirectorySource, path: string): string {
  const summary = `Semantic evidence cites ${path}`;
  try {
    const root = realpathSync(source.scopeRoot);
    const file = realpathSync(resolve(root, path));
    const scopedPath = relative(root, file);
    if (isAbsolute(scopedPath) || scopedPath === ".." || scopedPath.startsWith("../")) {
      return `${summary}; outside source scope`;
    }
    if (!statSync(file).isFile()) return `${summary}; non-file reference`;
    // Snapshot content at collection, so publication neither rereads mutable
    // evidence nor mistakes a revision change for a changed observation.
    return `${summary}; sha256=${createHash("sha256").update(readFileSync(file)).digest("hex")}`;
  } catch (error) {
    if (error instanceof Error && "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR" || error.code === "EACCES" || error.code === "EPERM")) {
      return `${summary}; content unavailable (${error.code})`;
    }
    throw error;
  }
}

export function listCanonicalProgressState(args: {
  source: ProgressReviewDirectorySource;
  semanticInput: ProgressReviewSemanticInput;
  autonomyIssueProjection: AutonomyIssueProjection;
}): ProgressReviewEvidenceRef[] {
  const queue = inspectRepoWorkSupply(resolveRepoWorkSupplyInput({ ...args.source, workspaceRoot: args.source.scopeRoot, stateDir: args.source.authorityStateDir }));
  const issues = args.autonomyIssueProjection.issues;
  const issueCounts = new Map<string, number>();
  for (const issue of issues) {
    issueCounts.set(issue.status, (issueCounts.get(issue.status) ?? 0) + 1);
  }
  const operational = readRunOperationalProjection({
    stateDir: args.source.authorityStateDir,
    scopeRoot: args.source.scopeRoot,
  });
  const attentionRuns = operational.runs.filter(
    (run) => run.state === "needs_attention",
  );
  const sandboxRuns = operational.runs.filter((run) => run.sandbox !== null);
  const window = args.semanticInput.evidenceWindow;
  return [
    ...(window ? [stateRef({
      source: args.source, id: "systemic-window", path: "progress-review-evidence.json",
      summary: `Pinned comparison ${window.startedAt}..${window.endedAt}, Git ${window.fromHead}..${window.toHead}. ` +
        `Historical baseline: ${summarizeSystemicRuns(window.baseline)}. New or revised outcomes: ${summarizeSystemicRuns(window.current)}. ` +
        "Repeated run ids are outcome revisions, not independent samples. " +
        `Excluded: ${window.excluded.join("; ") || "none"}. Delivery unavailable is not integration success.`,
    })] : []),
    stateRef({
      source: args.source,
      id: "queue",
      path: "data/tasks/",
      summary:
        `Canonical queue active=${queue.activeCount} actionable=${queue.actionableCount} ` +
        `available=${queue.availableCount} running=${queue.runningCount} queued=${queue.queuedCount} ` +
        `retained=${queue.retainedCount} ownershipAvailable=${queue.ownershipAvailable} ` +
        `dependencyBlocked=${queue.dependencyBlockedTasks.length}`,
    }),
    stateRef({
      source: args.source,
      id: "autonomy-issues",
      path: ".kota/kota.sqlite#autonomy/issues/projection",
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
      path: ".kota/kota.sqlite",
      summary:
        `Runtime state available=${operational.available} ` +
        `nonterminalRuns=${operational.runs.length} sandboxes=${sandboxRuns.length} ` +
        `needsAttention=${attentionRuns.length}`,
    }),
    stateRef({
      source: args.source,
      id: "owner-decisions",
      path: ".kota/owner-decisions/",
      summary: `Owner decisions ${ownerDecisionCounts(args.source.stateDir, args.source.scopeId)}`,
    }),
    ...[...new Set(args.semanticInput.evidenceRefs)].sort().map((path) =>
      stateRef({
        source: args.source,
        id: `semantic-input:${path}`,
        path,
        // Admission revisions belong to the packet, not the cited observation.
        summary: semanticEvidenceSummary(args.source, path),
      })
    ),
  ];
}
