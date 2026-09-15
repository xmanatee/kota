import type { Dirent } from "node:fs";
import { existsSync, lstatSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  PROGRESS_REVIEW_MAX_ARTIFACT_DEPTH,
  PROGRESS_REVIEW_MAX_ARTIFACTS,
  PROGRESS_REVIEW_MAX_RUNS,
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

function unreadableDirectoryCode(error: Error): "EACCES" | "EPERM" | null {
  if (!("code" in error)) return null;
  if (error.code === "EACCES" || error.code === "EPERM") return error.code;
  return null;
}

function listRunArtifactFiles(runDir: string, maxFiles: number): RunArtifactListing {
  const root = resolve(runDir);
  const files: string[] = [];
  let hitDepthLimit = false;
  const unreadableDirectories: string[] = [];
  const manifestsDir = join(root, "evidence", "manifests");
  try {
    if (existsSync(manifestsDir) && lstatSync(join(root, "evidence")).isDirectory() && lstatSync(manifestsDir).isDirectory()) {
      const manifests = readdirSync(manifestsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name))
        .map((entry) => ({ name: entry.name, modifiedAt: statSync(join(manifestsDir, entry.name)).mtimeMs }))
        .sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name));
      if (manifests[0]) files.push(`evidence/manifests/${manifests[0].name}`);
    }
  } catch (error) {
    const code = error instanceof Error ? unreadableDirectoryCode(error) : null;
    if (code === null) throw error;
    unreadableDirectories.push(`evidence/manifests (${code})`);
  }
  function visit(dir: string, relativeParts: string[]): boolean {
    if (files.length >= maxFiles) return true;
    const resolvedDir = resolve(dir);
    assertPathInside(root, resolvedDir, "progress-review artifact directory");
    if (relativeParts.length >= PROGRESS_REVIEW_MAX_ARTIFACT_DEPTH) {
      hitDepthLimit = true;
      return false;
    }
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    } catch (error) {
      const code = error instanceof Error ? unreadableDirectoryCode(error) : null;
      if (code === null) throw error;
      const relativePath = relativeParts.join("/") || ".";
      unreadableDirectories.push(`${relativePath} (${code})`);
      return false;
    }
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
        if (nextParts[0] === "evidence" || nextParts[0] === "retained-runtime") continue;
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
  return {
    files,
    hitFileLimit,
    hitDepthLimit,
    unreadableDirectories,
  };
}

export function listArtifactEvidence(
  runs: readonly ScopedRunEvidence[],
  excluded: string[],
): ProgressReviewArtifactEvidence[] {
  const artifacts: ProgressReviewArtifactEvidence[] = [];
  const listings = runs.slice(0, PROGRESS_REVIEW_MAX_RUNS).flatMap((run) => {
    const runsRoot = resolve(run.source.stateDir, "runs");
    const runDir = resolve(runsRoot, run.runId);
    assertPathInside(runsRoot, runDir, "progress-review run directory");
    if (!existsSync(runDir)) return [];
    const listing = listRunArtifactFiles(runDir, PROGRESS_REVIEW_MAX_ARTIFACTS);
    if (listing.hitDepthLimit) {
      excluded.push(
        `artifacts for ${run.runId}: skipped entries deeper than ${PROGRESS_REVIEW_MAX_ARTIFACT_DEPTH} path segments`,
      );
    }
    for (const directory of listing.unreadableDirectories) {
      excluded.push(
        `artifacts for ${run.runId}: skipped unreadable directory ${directory}`,
      );
    }
    return [{ run, listing }];
  });
  for (let index = 0; artifacts.length < PROGRESS_REVIEW_MAX_ARTIFACTS; index++) {
    let added = false;
    for (const { run, listing } of listings) {
      const name = listing.files[index];
      if (name === undefined) continue;
      added = true;
      artifacts.push({
        id: sourceEvidenceId(run.source, `artifact:${run.runId}:${name}`),
        kind: "artifact", runId: run.runId, file: name,
        path: join(".kota", "runs", run.runId, ...name.split("/")),
        summary: sourceSummary(run.source, `${name} from ${run.evidence.workflow} ${run.evidence.status} (${run.runId})`),
      });
      if (artifacts.length === PROGRESS_REVIEW_MAX_ARTIFACTS) break;
    }
    if (!added) break;
  }
  if (listings.some(({ listing }) => listing.hitFileLimit) ||
      listings.reduce((count, { listing }) => count + listing.files.length, 0) > artifacts.length) {
    excluded.push(`artifacts: truncated after ${PROGRESS_REVIEW_MAX_ARTIFACTS} files`);
  }
  if (runs.length > PROGRESS_REVIEW_MAX_RUNS) excluded.push(`artifacts: selected ${PROGRESS_REVIEW_MAX_RUNS} current/intervention runs; other run summaries remain available`);
  return artifacts;
}
