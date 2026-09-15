import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { readAnchoredTextFiles } from "#core/util/filesystem/anchored-files.js";
import type { WorkflowRunToolRunner } from "#core/workflow/run-types.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
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
    notes: entry.notes ?? null,
    fingerprint: sources[entry.url]?.fingerprint ?? null,
  })).sort((a, b) => a.url.localeCompare(b.url));
  return createHash("sha256").update(JSON.stringify({ tasks, evidence })).digest("hex");
}

/** Refresh known sources and identify material not yet reviewed; queue demand owns discovery admission. */
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
  const observations: { url: string; accessible: boolean; changed: boolean; contentPath: string; evidencePath: string;
    origin: "fetch" | "retained"; observedAt: string }[] = [];
  const sourceDir = join(input.artifactDir, "source-evidence");
  const evidenceDir = join(input.evidenceDir, "source-evidence");
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });
  const pending = entries.values();
  const refresh = async () => {
    for (const entry of pending) {
      const previous = sources[entry.url];
      const refreshMs = (entry.refresh === "weekly" ? 7 : 1) * 24 * 60 * 60 * 1000;
      if (previous && Date.now() - Date.parse(previous.checkedAt) < refreshMs) continue;
      const result = await input.runTool("web_fetch", { url: entry.url });
      const accessible = !result.is_error && result.content.trim().length > 0;
      const observedAt = new Date().toISOString();
      sources[entry.url] = {
        checkedAt: observedAt,
        ...(accessible ? { readable: { runId: basename(input.evidenceDir), observedAt } }
          : previous?.readable ? { readable: previous.readable } : {}),
        fingerprint: accessible
          ? computeWatchlistFingerprint(normalizeWatchlistContent(result.content))
          : previous?.fingerprint ?? null,
      };
      const filename = `${createHash("sha256").update(entry.url).digest("hex")}.txt${accessible ? ".readable" : ""}`;
      const contentPath = join(sourceDir, filename);
      const evidencePath = join(evidenceDir, filename);
      writeFileSync(evidencePath, result.content, "utf8");
      writeFileSync(contentPath, result.content, "utf8");
      observations.push({ url: entry.url, accessible, contentPath, evidencePath, origin: "fetch", observedAt,
        changed: accessible && previous?.fingerprint !== sources[entry.url].fingerprint });
    }
  };
  await Promise.all(Array.from({ length: Math.min(input.capacity, entries.length) }, refresh));
  // Reuse only bytes anchored in this scope's run store and matching the retained
  // content identity. Fingerprints and watchlist summaries alone are not readable evidence.
  const retained = entries.filter((entry) => sources[entry.url]?.readable &&
    !observations.some((observation) => observation.url === entry.url && observation.accessible));
  const runsRoot = dirname(input.evidenceDir);
  for (let offset = 0; offset < retained.length; offset += 64) {
    const batch = retained.slice(offset, offset + 64).map((entry) => {
      const source = sources[entry.url]!;
      const filename = `${createHash("sha256").update(entry.url).digest("hex")}.txt.readable`;
      return { entry, source, filename, evidencePath: join(runsRoot, source.readable!.runId, "source-evidence", filename) };
    });
    const results = await readAnchoredTextFiles(batch.map(({ evidencePath }) => ({
      rootPath: runsRoot, boundaryDir: runsRoot, filePath: evidencePath, maxBytes: 128 * 1024,
    })));
    for (const [index, result] of results.entries()) {
      const { entry, source, filename, evidencePath } = batch[index]!;
      if (!result.ok || !result.file || !result.file.content.trim() ||
        computeWatchlistFingerprint(normalizeWatchlistContent(result.file.content)) !== source.fingerprint) continue;
      const contentPath = join(sourceDir, filename);
      writeFileSync(contentPath, result.file.content, "utf8");
      observations.push({ url: entry.url, accessible: true, changed: false, contentPath, evidencePath,
        origin: "retained", observedAt: source.readable!.observedAt });
    }
  }
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
        ? "Source recheck is not due and no readable retained source evidence is available"
        : "No readable fresh or retained source evidence is available; recheck access before proposing work"
      : changed ? "Unreviewed source or task evidence" : "Source and task evidence already reviewed",
    revisit: "Review again when observed source content or task intent changes; elapsed time only permits source rechecks",
  };
}
