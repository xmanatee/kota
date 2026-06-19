import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  PROGRESS_REVIEW_MAX_ARTIFACT_DEPTH,
  PROGRESS_REVIEW_MAX_ARTIFACTS,
} from "./constants.js";
import { sourceEvidenceId, sourceSummary } from "./trigger-target.js";
import type {
  ProgressReviewArtifactEvidence,
  RunArtifactListing,
  ScopedRunEvidence,
} from "./types.js";

function isArtifactFile(relativePath: string): boolean {
  return (
    relativePath !== "metadata.json" &&
    relativePath !== "trigger.json" &&
    relativePath !== "workflow.json"
  );
}

function isPathInside(parent: string, child: string): boolean {
  const fromParent = relative(parent, child);
  return fromParent === "" || (!fromParent.startsWith("..") && !isAbsolute(fromParent));
}

function assertPathInside(parent: string, child: string, label: string): void {
  if (isPathInside(parent, child)) return;
  throw new Error(`${label} escaped progress-review artifact boundary`);
}

function listRunArtifactFiles(runDir: string, maxFiles: number): RunArtifactListing {
  const root = resolve(runDir);
  const files: string[] = [];
  let hitDepthLimit = false;
  function visit(dir: string, relativeParts: string[]): boolean {
    if (files.length >= maxFiles) return true;
    const resolvedDir = resolve(dir);
    assertPathInside(root, resolvedDir, "progress-review artifact directory");
    if (relativeParts.length >= PROGRESS_REVIEW_MAX_ARTIFACT_DEPTH) {
      hitDepthLimit = true;
      return false;
    }
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      if (files.length >= maxFiles) return true;
      const nextParts = [...relativeParts, entry.name];
      const path = resolve(dir, entry.name);
      assertPathInside(root, path, "progress-review artifact path");
      if (nextParts.length > PROGRESS_REVIEW_MAX_ARTIFACT_DEPTH) {
        hitDepthLimit = true;
        continue;
      }
      if (entry.isDirectory()) {
        if (nextParts.length >= PROGRESS_REVIEW_MAX_ARTIFACT_DEPTH) {
          hitDepthLimit = true;
          continue;
        }
        if (visit(path, nextParts)) return true;
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = nextParts.join("/");
      if (isArtifactFile(relativePath)) files.push(relativePath);
    }
    return files.length >= maxFiles;
  }
  const hitFileLimit = visit(root, []);
  return { files: files.sort(), hitFileLimit, hitDepthLimit };
}

export function listArtifactEvidence(
  runs: readonly ScopedRunEvidence[],
  excluded: string[],
): ProgressReviewArtifactEvidence[] {
  const artifacts: ProgressReviewArtifactEvidence[] = [];
  for (const run of runs) {
    const runsRoot = resolve(run.source.projectDir, ".kota", "runs");
    const runDir = resolve(runsRoot, run.runId);
    assertPathInside(runsRoot, runDir, "progress-review run directory");
    if (!existsSync(runDir)) continue;
    const listing = listRunArtifactFiles(runDir, PROGRESS_REVIEW_MAX_ARTIFACTS - artifacts.length);
    for (const name of listing.files) {
      const path = resolve(runDir, ...name.split("/"));
      assertPathInside(runDir, path, "progress-review artifact path");
      artifacts.push({
        id: sourceEvidenceId(run.source, `artifact:${run.runId}:${name}`),
        kind: "artifact",
        runId: run.runId,
        file: name,
        path: join(".kota", "runs", run.runId, ...name.split("/")),
        summary: sourceSummary(
          run.source,
          `${name} from ${run.evidence.workflow} ${run.evidence.status} (${run.runId})`,
        ),
      });
    }
    if (listing.hitDepthLimit) {
      excluded.push(
        `artifacts for ${run.runId}: skipped entries deeper than ${PROGRESS_REVIEW_MAX_ARTIFACT_DEPTH} path segments`,
      );
    }
    if (listing.hitFileLimit) {
      excluded.push(`artifacts: truncated after ${PROGRESS_REVIEW_MAX_ARTIFACTS} files`);
      return artifacts;
    }
  }
  return artifacts;
}
