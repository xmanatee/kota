import { readdirSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { readOptionalJsonFile } from "../json-file.js";
import { WorkflowRunStore } from "../workflow/run-store.js";
import type { WorkflowRunMetadata } from "../workflow/types.js";
import { jsonResponse } from "./session-pool.js";

type RunSummary = {
  id: string;
  workflow: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  totalCostUsd?: number;
};

function toSummary(meta: WorkflowRunMetadata): RunSummary {
  return {
    id: meta.id,
    workflow: meta.workflow,
    status: meta.status,
    startedAt: meta.startedAt,
    ...(meta.completedAt !== undefined && { completedAt: meta.completedAt }),
    ...(meta.durationMs !== undefined && { durationMs: meta.durationMs }),
    ...(meta.totalCostUsd !== undefined && { totalCostUsd: meta.totalCostUsd }),
  };
}

export function listRunMetadata(
  store: WorkflowRunStore,
  limit: number,
  offset: number,
): WorkflowRunMetadata[] {
  let dirs: string[];
  try {
    dirs = readdirSync(store.runsDir).sort().reverse();
  } catch {
    return [];
  }
  const runs: WorkflowRunMetadata[] = [];
  for (const dir of dirs) {
    if (runs.length >= offset + limit) break;
    const metadataPath = join(store.runsDir, dir, "metadata.json");
    const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);
    if (metadata) runs.push(metadata);
  }
  return runs.slice(offset, offset + limit);
}

export function handleWorkflowStatus(
  res: ServerResponse,
  store = new WorkflowRunStore(),
): void {
  const state = store.readState();
  jsonResponse(res, 200, {
    activeRuns: state.activeRuns ?? [],
    queueLength: state.pendingRuns.length,
    completedRuns: state.completedRuns,
    workflows: state.workflows,
  });
}

export function handleWorkflowRuns(
  res: ServerResponse,
  url: URL,
  store = new WorkflowRunStore(),
): void {
  const rawLimit = url.searchParams.has("limit")
    ? Number.parseInt(url.searchParams.get("limit")!, 10)
    : 20;
  const rawOffset = url.searchParams.has("offset")
    ? Number.parseInt(url.searchParams.get("offset")!, 10)
    : 0;
  const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 200);
  const offset = Number.isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

  const runs = listRunMetadata(store, limit, offset);
  jsonResponse(res, 200, { runs: runs.map(toSummary), limit, offset });
}

export function handleWorkflowRunDetail(
  res: ServerResponse,
  runId: string,
  store = new WorkflowRunStore(),
): void {
  if (!runId || runId.includes("/") || runId.includes("..")) {
    jsonResponse(res, 400, { error: "Invalid run ID" });
    return;
  }
  const metadataPath = join(store.runsDir, runId, "metadata.json");
  const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);
  if (!metadata) {
    jsonResponse(res, 404, { error: "Run not found" });
    return;
  }
  jsonResponse(res, 200, metadata);
}
