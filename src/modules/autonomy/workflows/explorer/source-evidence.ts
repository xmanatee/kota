import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowRunToolRunner } from "#core/workflow/run-types.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import { EXPLORATION_REFRESH_MS } from "./assessment.js";
import type { ExplorerState } from "./explorer-state.js";
import { readWatchlist } from "./watchlist.js";
import { computeWatchlistFingerprint, normalizeWatchlistContent } from "./watchlist-classifier.js";

export function explorationFingerprint(workspaceRoot: string, sources: ExplorerState["sources"]): string {
  const tasks = listFullRepoTasks(workspaceRoot).map(({ id, state, priority, dependsOn, body }) => ({
    id, state, priority, dependsOn: [...dependsOn].sort(), body,
  }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const evidence = readWatchlist(workspaceRoot).entries.map((entry) => ({
    url: entry.url,
    fingerprint: sources[entry.url]?.fingerprint ?? null,
  })).sort((a, b) => a.url.localeCompare(b.url));
  return createHash("sha256").update(JSON.stringify({ tasks, evidence })).digest("hex");
}

/** Time admits network observation; only changed evidence admits another AI review. */
export async function refreshExplorerSources(input: {
  workspaceRoot: string;
  current: ExplorerState;
  runTool: WorkflowRunToolRunner;
  capacity: number;
  /** Agent-readable working copy, removed with the run sandbox. */
  artifactDir: string;
  /** Retained run evidence, outside the temporary sandbox. */
  evidenceDir: string;
}) {
  const entries = readWatchlist(input.workspaceRoot).entries;
  const sources = { ...input.current.sources };
  const observations: { url: string; accessible: boolean; changed: boolean; contentPath: string; evidencePath: string }[] = [];
  const sourceDir = join(input.artifactDir, "source-evidence");
  const evidenceDir = join(input.evidenceDir, "source-evidence");
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });
  const pending = entries.values();
  const refresh = async () => {
    for (const entry of pending) {
      const previous = sources[entry.url];
      if (previous && Date.now() - Date.parse(previous.checkedAt) < EXPLORATION_REFRESH_MS) continue;
      const result = await input.runTool("web_fetch", { url: entry.url });
      const accessible = !result.is_error && result.content.trim().length > 0;
      sources[entry.url] = {
        checkedAt: new Date().toISOString(),
        fingerprint: accessible
          ? computeWatchlistFingerprint(normalizeWatchlistContent(result.content))
          : previous?.fingerprint ?? null,
      };
      const filename = `${createHash("sha256").update(entry.url).digest("hex")}.txt`;
      const contentPath = join(sourceDir, filename);
      const evidencePath = join(evidenceDir, filename);
      writeFileSync(evidencePath, result.content, "utf8");
      writeFileSync(contentPath, result.content, "utf8");
      observations.push({ url: entry.url, accessible, contentPath, evidencePath,
        changed: accessible && previous?.fingerprint !== sources[entry.url].fingerprint });
    }
  };
  await Promise.all(Array.from({ length: Math.min(input.capacity, entries.length) }, refresh));
  observations.sort((a, b) => a.url.localeCompare(b.url));
  const fingerprint = explorationFingerprint(input.workspaceRoot, sources);
  const evidenceAvailable = entries.length === 0 || observations.some((entry) => entry.accessible);
  const changed = fingerprint !== input.current.lastReviewedFingerprint;
  return {
    sources,
    observations,
    fingerprint,
    shouldReview: evidenceAvailable && changed,
    reason: !evidenceAvailable
      ? observations.length === 0
        ? "Source recheck is not due; no fresh source evidence collected"
        : "Sources are inaccessible; recheck access before proposing work"
      : changed ? "Unreviewed source or task evidence" : "Source and task evidence already reviewed",
    revisit: "Review again when observed source content or task intent changes; elapsed time only permits source rechecks",
  };
}
