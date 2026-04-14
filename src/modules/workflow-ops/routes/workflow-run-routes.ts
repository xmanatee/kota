import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { jsonResponse, SseTransport, setCors } from "#core/server/session-pool.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { BuilderRunSummary } from "#modules/autonomy/workflows/builder/run-summary.js";
import { readStepEvents } from "../runs/workflow-logs.js";

type RunSummary = {
  id: string;
  workflow: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  totalCostUsd?: number;
  triggerEvent?: string;
  tags?: string[];
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
    ...(meta.trigger?.event !== undefined && { triggerEvent: meta.trigger.event }),
    ...(meta.tags !== undefined && { tags: meta.tags }),
  };
}

export function listRunMetadata(
  store: WorkflowRunStore,
  limit: number,
  offset: number,
  since?: number,
  causedByRunId?: string,
): WorkflowRunMetadata[] {
  let dirs: string[];
  try {
    dirs = readdirSync(store.runsDir).sort().reverse();
  } catch {
    return [];
  }
  const runs: WorkflowRunMetadata[] = [];
  for (const dir of dirs) {
    if (since === undefined && causedByRunId === undefined && runs.length >= offset + limit) break;
    const metadataPath = join(store.runsDir, dir, "metadata.json");
    const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);
    if (!metadata) continue;
    if (since !== undefined && new Date(metadata.startedAt).getTime() < since) break;
    if (causedByRunId !== undefined && metadata.causedBy?.runId !== causedByRunId) continue;
    runs.push(metadata);
  }
  if (since !== undefined) return runs;
  if (causedByRunId !== undefined) return runs.slice(offset, offset + limit);
  return runs.slice(offset, offset + limit);
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
  const causedByRunId = url.searchParams.get("causedByRunId") ?? undefined;

  const runs = listRunMetadata(store, limit, offset, undefined, causedByRunId);
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
  const runDir = join(store.runsDir, runId);
  const metadata = readOptionalJsonFile<WorkflowRunMetadata>(join(runDir, "metadata.json"));
  if (!metadata) {
    jsonResponse(res, 404, { error: "Run not found" });
    return;
  }
  const workflowDef = readOptionalJsonFile<{
    steps?: Array<{ id: string; type: string; reason?: string }>;
  }>(join(runDir, "workflow.json"));
  const workflowSteps = workflowDef?.steps?.map((s) => ({
    id: s.id,
    type: s.type,
    ...(s.type === "approval" && s.reason != null ? { reason: s.reason } : {}),
  }));
  jsonResponse(res, 200, { ...metadata, ...(workflowSteps && { workflowSteps }) });
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
          const msg = event.message as { content?: Array<{ type: string; text?: string; name?: string; thinking?: string }> } | undefined;
          for (const block of msg?.content ?? []) {
            if (block.type === "text" && block.text) {
              sse.send("step_output", { stepId, text: block.text });
            } else if (block.type === "tool_use" && block.name) {
              sse.send("step_tool", { stepId, tool: block.name });
            } else if (block.type === "thinking" && block.thinking) {
              sse.send("step_thinking", { stepId, thinking: block.thinking });
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

const ARTIFACT_SKIP = new Set(["metadata.json", "workflow.json", "trigger.json"]);

export type RunArtifacts = {
  runSummary: BuilderRunSummary | null;
  commitMessage: string | null;
  textFiles: Array<{ name: string; content: string }>;
};

export function handleWorkflowRunArtifacts(
  res: ServerResponse,
  runId: string,
  store = new WorkflowRunStore(),
): void {
  if (!runId || runId.includes("/") || runId.includes("..")) {
    jsonResponse(res, 400, { error: "Invalid run ID" });
    return;
  }
  const runDir = join(store.runsDir, runId);
  if (!existsSync(runDir)) {
    jsonResponse(res, 404, { error: "Run not found" });
    return;
  }

  const runSummary = readOptionalJsonFile<BuilderRunSummary>(join(runDir, "run-summary.json"));

  let commitMessage: string | null = null;
  const commitMsgPath = join(runDir, "commit-message.txt");
  if (existsSync(commitMsgPath)) {
    try {
      commitMessage = readFileSync(commitMsgPath, "utf-8").trim();
    } catch {
      // unreadable — leave null
    }
  }

  const textFiles: Array<{ name: string; content: string }> = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(runDir);
  } catch {
    // directory gone — return what we have
  }
  for (const name of entries) {
    if (ARTIFACT_SKIP.has(name) || name === "run-summary.json" || name === "commit-message.txt") continue;
    const ext = extname(name);
    if (ext !== ".txt" && ext !== ".md") continue;
    try {
      textFiles.push({ name, content: readFileSync(join(runDir, name), "utf-8") });
    } catch {
      // skip unreadable files
    }
  }

  const artifacts: RunArtifacts = { runSummary, commitMessage, textFiles };
  jsonResponse(res, 200, artifacts);
}

export function handleWorkflowRunThinking(
  res: ServerResponse,
  runId: string,
  store = new WorkflowRunStore(),
): void {
  if (!runId || runId.includes("/") || runId.includes("..")) {
    jsonResponse(res, 400, { error: "Invalid run ID" });
    return;
  }
  const runDir = join(store.runsDir, runId);
  const metadata = readOptionalJsonFile<WorkflowRunMetadata>(join(runDir, "metadata.json"));
  if (!metadata) {
    jsonResponse(res, 404, { error: "Run not found" });
    return;
  }

  const thinking: Record<string, string[]> = {};
  for (const step of metadata.steps) {
    if (step.type !== "agent") continue;
    const eventsPath = join(runDir, "steps", `${step.id}.events.jsonl`);
    const events = readStepEvents(eventsPath);
    const blocks: string[] = [];
    for (const event of events) {
      if (event.type !== "assistant") continue;
      const content = (event as { message?: { content?: Array<{ type: string; thinking?: string }> }; content?: Array<{ type: string; thinking?: string }> }).message?.content
        ?? (event as { content?: Array<{ type: string; thinking?: string }> }).content
        ?? [];
      for (const block of content) {
        if (block.type === "thinking" && block.thinking) {
          blocks.push(block.thinking);
        }
      }
    }
    if (blocks.length > 0) {
      thinking[step.id] = blocks;
    }
  }

  jsonResponse(res, 200, { thinking });
}
