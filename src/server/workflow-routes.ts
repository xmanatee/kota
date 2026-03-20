import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { readOptionalJsonFile } from "../json-file.js";
import { WorkflowRunStore } from "../workflow/run-store.js";
import type { WorkflowRunMetadata } from "../workflow/types.js";
import { jsonResponse, SseTransport, setCors } from "./session-pool.js";

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
  since?: number,
): WorkflowRunMetadata[] {
  let dirs: string[];
  try {
    dirs = readdirSync(store.runsDir).sort().reverse();
  } catch {
    return [];
  }
  const runs: WorkflowRunMetadata[] = [];
  for (const dir of dirs) {
    if (since === undefined && runs.length >= offset + limit) break;
    const metadataPath = join(store.runsDir, dir, "metadata.json");
    const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);
    if (!metadata) continue;
    if (since !== undefined && new Date(metadata.startedAt).getTime() < since) break;
    runs.push(metadata);
  }
  if (since !== undefined) return runs;
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
  const rawSince = url.searchParams.get("since");
  const since =
    rawSince !== null && !Number.isNaN(Number(rawSince)) ? Number(rawSince) : undefined;

  if (since !== undefined) {
    const runs = listRunMetadata(store, 0, 0, since);
    jsonResponse(res, 200, { runs: runs.map(toSummary), since });
    return;
  }

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

export function handleWorkflowRunStream(
  res: ServerResponse,
  runId: string,
  store = new WorkflowRunStore(),
): void {
  if (!runId || runId.includes("/") || runId.includes("..")) {
    jsonResponse(res, 400, { error: "Invalid run ID" });
    return;
  }
  const runDir = join(store.runsDir, runId);
  const metadataPath = join(runDir, "metadata.json");
  const stepsDir = join(runDir, "steps");

  const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);
  if (!metadata) {
    jsonResponse(res, 404, { error: "Run not found" });
    return;
  }
  if (metadata.status !== "running") {
    jsonResponse(res, 404, { error: "Run is not active" });
    return;
  }

  setCors(res);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const sse = new SseTransport(res);
  const jsonlOffsets: Record<string, number> = {};
  const announcedSteps = new Set<string>();
  const completedSteps = new Set<string>();

  function getActiveStepIds(): string[] {
    try {
      return readdirSync(stepsDir)
        .filter((f) => f.endsWith(".events.jsonl"))
        .map((f) => f.slice(0, -".events.jsonl".length));
    } catch {
      return [];
    }
  }

  function streamStepJsonl(stepId: string): void {
    const eventsPath = join(stepsDir, `${stepId}.events.jsonl`);
    if (!existsSync(eventsPath)) return;
    let content: string;
    try {
      content = readFileSync(eventsPath, "utf-8");
    } catch {
      return;
    }
    const lines = content.split("\n").filter((l) => l.trim());
    const offset = jsonlOffsets[stepId] ?? 0;
    const newLines = lines.slice(offset);
    jsonlOffsets[stepId] = lines.length;

    for (const line of newLines) {
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event.type === "assistant") {
          const msg = event.message as { content?: Array<{ type: string; text?: string; name?: string }> } | undefined;
          for (const block of msg?.content ?? []) {
            if (block.type === "text" && block.text) {
              sse.send("step_output", { stepId, text: block.text });
            } else if (block.type === "tool_use" && block.name) {
              sse.send("step_tool", { stepId, tool: block.name });
            }
          }
        }
      } catch {
        // malformed line — skip
      }
    }
  }

  function poll(): void {
    if (sse.isClosed) return;

    const meta = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);
    if (!meta) return;

    // Completed steps from metadata
    for (const step of meta.steps) {
      if (!announcedSteps.has(step.id)) {
        announcedSteps.add(step.id);
        sse.send("step_started", { stepId: step.id, type: step.type, startedAt: step.startedAt });
      }
      if (!completedSteps.has(step.id)) {
        streamStepJsonl(step.id);
        completedSteps.add(step.id);
        sse.send("step_completed", {
          stepId: step.id,
          status: step.status,
          durationMs: step.durationMs,
          ...(step.output !== undefined && { output: step.output }),
          ...(step.error !== undefined && { error: step.error }),
        });
      }
    }

    // Active (in-progress) steps from steps dir
    for (const stepId of getActiveStepIds()) {
      if (!completedSteps.has(stepId)) {
        if (!announcedSteps.has(stepId)) {
          announcedSteps.add(stepId);
          sse.send("step_started", { stepId, type: "agent" });
        }
        streamStepJsonl(stepId);
      }
    }

    if (meta.status !== "running") {
      sse.send("run_completed", {
        status: meta.status,
        ...(meta.durationMs !== undefined && { durationMs: meta.durationMs }),
        ...(meta.totalCostUsd !== undefined && { totalCostUsd: meta.totalCostUsd }),
      });
      sse.end();
      clearInterval(intervalId);
    }
  }

  const intervalId = setInterval(poll, 500);
  poll();
  res.on("close", () => clearInterval(intervalId));
}
