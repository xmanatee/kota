import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, join } from "node:path";
import type { AgentUsage } from "#core/agent-harness/usage.js";
import {
  type EvidenceArtifactReference,
  type EvidenceJsonObject,
  type EvidenceProvenance,
  type EvidenceRedactionMarker,
  projectEvidenceObject,
  projectEvidenceText,
  redactSensitiveText,
} from "#core/evidence/policy.js";
import { jsonResponse, SseTransport, setCors } from "#core/server/session-pool.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRunMetadata, WorkflowStepResult } from "#core/workflow/run-types.js";
import {
  WRITER_INTEGRATION_EVIDENCE,
  type WriterIntegrationEvidence,
} from "#core/workflow/writer-integration-evidence.js";
import {
  parseKotaAgentMessageLine,
  projectAgentMessageToRunStreamEvents,
} from "../runs/stream-projection.js";
import { readStepEvents } from "../runs/workflow-logs.js";

type RunSummary = {
  id: string;
  workflow: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  usage?: AgentUsage;
  triggerEvent?: string;
  tags?: string[];
  provenance: EvidenceProvenance;
};

function toSummary(meta: WorkflowRunMetadata): RunSummary {
  return {
    id: meta.id,
    workflow: meta.workflow,
    status: meta.status,
    startedAt: meta.startedAt,
    ...(meta.completedAt !== undefined && { completedAt: meta.completedAt }),
    ...(meta.durationMs !== undefined && { durationMs: meta.durationMs }),
    ...(meta.usage !== undefined && { usage: meta.usage }),
    ...(meta.trigger?.event !== undefined && { triggerEvent: meta.trigger.event }),
    ...(meta.tags !== undefined && { tags: meta.tags }),
    provenance: workflowRunProvenance(meta),
  };
}

function workflowRunProvenance(meta: WorkflowRunMetadata): EvidenceProvenance {
  const sourceEventIds: string[] = [];
  if (meta.trigger.eventId !== undefined) sourceEventIds.push(meta.trigger.eventId);
  const transformedFrom: EvidenceArtifactReference[] = sourceEventIds.map((id) => ({
    artifactType: "event-envelope" as const,
    id,
  }));
  if (meta.causedBy !== undefined) {
    transformedFrom.push({ artifactType: "workflow-run", id: meta.causedBy.runId });
  }
  return {
    workflowName: meta.workflow,
    runId: meta.id,
    sourceEventIds,
    transformedFrom,
  };
}

function projectRunDetailMetadata(meta: WorkflowRunMetadata): EvidenceJsonObject {
  const projected = projectEvidenceObject(meta, "daemon-api");
  projected.steps = meta.steps.map((step) => {
    const projectedStep = projectEvidenceObject(step, "daemon-api");
    if (step.output !== undefined) {
      projectedStep.output = projectEvidenceText(
        JSON.stringify(step.output),
        "daemon-api",
        "tool-io",
      );
    }
    return projectedStep;
  });
  projected.provenance = projectEvidenceObject(workflowRunProvenance(meta), "daemon-api");
  return projected;
}

function projectStepCompletedPayload(step: WorkflowStepResult): EvidenceJsonObject {
  const projected: EvidenceJsonObject = {
    stepId: step.id,
    status: step.status,
    durationMs: step.durationMs,
  };
  if (step.output !== undefined) {
    projected.output = projectEvidenceText(
      JSON.stringify(step.output),
      "daemon-api",
      "tool-io",
    );
  }
  if (step.error !== undefined) {
    projected.error = projectEvidenceText(
      typeof step.error === "string" ? step.error : JSON.stringify(step.error),
      "daemon-api",
      "tool-io",
    );
  }
  return projected;
}

export function listRunMetadata(
  store: WorkflowRunStore,
  limit: number,
  offset: number,
  since?: number,
  causedByRunId?: string,
  workflow?: string,
  tag?: string,
): WorkflowRunMetadata[] {
  const runs = store.listRuns({
    limit: Number.MAX_SAFE_INTEGER,
    causedByRunId,
    workflow,
    tag,
  }).filter((run) => since === undefined || Date.parse(run.startedAt) >= since);
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
  const workflow = url.searchParams.get("workflow") ?? undefined;
  const tag = url.searchParams.get("tag") ?? undefined;

  if (since !== undefined) {
    const runs = listRunMetadata(store, 0, 0, since, undefined, workflow, tag);
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

  const runs = listRunMetadata(store, limit, offset, undefined, causedByRunId, workflow, tag);
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
  const metadata = store.getRun(runId);
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
  jsonResponse(res, 200, { ...projectRunDetailMetadata(metadata), ...(workflowSteps && { workflowSteps }) });
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
  const stepsDir = join(runDir, "steps");

  const metadata = store.getRun(runId);
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

  function streamStepJsonl(stepId: string, flushTrailingLine = false): void {
    const eventsPath = join(stepsDir, `${stepId}.events.jsonl`);
    if (!existsSync(eventsPath)) return;
    let content: string;
    try {
      content = readFileSync(eventsPath, "utf-8");
    } catch {
      return;
    }
    let offset = jsonlOffsets[stepId] ?? 0;
    if (offset > content.length) offset = 0;

    const chunk = content.slice(offset);
    const lastNewlineIndex = chunk.lastIndexOf("\n");
    let completeChunk = "";
    if (lastNewlineIndex >= 0) {
      completeChunk = chunk.slice(0, lastNewlineIndex);
      jsonlOffsets[stepId] = offset + lastNewlineIndex + 1;
    } else if (flushTrailingLine && chunk.trim()) {
      completeChunk = chunk;
      jsonlOffsets[stepId] = content.length;
    } else {
      return;
    }

    for (const line of completeChunk.split("\n").filter((l) => l.trim())) {
      const message = parseKotaAgentMessageLine(line);
      if (!message) continue;
      for (const event of projectAgentMessageToRunStreamEvents(stepId, message)) {
        sse.send(event.eventName, event.payload);
      }
    }
  }

  function poll(): void {
    if (sse.isClosed) return;

    const meta = store.getRun(runId);
    if (!meta) return;

    // Completed steps from metadata
    for (const step of meta.steps) {
      if (!announcedSteps.has(step.id)) {
        announcedSteps.add(step.id);
        sse.send("step_started", { stepId: step.id, type: step.type, startedAt: step.startedAt });
      }
      if (!completedSteps.has(step.id)) {
        streamStepJsonl(step.id, true);
        completedSteps.add(step.id);
        sse.send("step_completed", projectStepCompletedPayload(step));
      }
    }

    // Active (in-progress) steps from steps dir
    for (const stepId of getActiveStepIds()) {
      if (!completedSteps.has(stepId)) {
        if (!announcedSteps.has(stepId)) {
          announcedSteps.add(stepId);
          sse.send("step_started", { stepId, type: "agent" });
        }
        streamStepJsonl(stepId, meta.status !== "running");
      }
    }

    if (meta.status !== "running") {
      sse.send("run_completed", {
        status: meta.status,
        ...(meta.durationMs !== undefined && { durationMs: meta.durationMs }),
        ...(meta.usage !== undefined && { usage: meta.usage }),
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
  writerIntegration: EvidenceJsonObject | null;
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
  if (store.getRun(runId) === null) {
    jsonResponse(res, 404, { error: "Run not found" });
    return;
  }
  const runDir = join(store.runsDir, runId);

  const rawWriterIntegration = readOptionalJsonFile<WriterIntegrationEvidence>(
    join(runDir, WRITER_INTEGRATION_EVIDENCE),
  );
  const writerIntegration = rawWriterIntegration
    ? projectEvidenceObject(rawWriterIntegration, "daemon-api")
    : null;

  let commitMessage: string | null = null;
  const commitMsgPath = join(runDir, "commit-message.txt");
  if (pathHasDirectoryEntry(commitMsgPath)) {
    try {
      commitMessage = redactSensitiveText(readFileSync(commitMsgPath, "utf-8").trim());
    } catch (err) {
      writeArtifactReadError(res, "commit-message.txt", err);
      return;
    }
  }

  const textFiles: Array<{ name: string; content: string }> = [];
  let entries: string[];
  try {
    entries = readdirSync(runDir);
  } catch (err) {
    writeArtifactReadError(res, runId, err);
    return;
  }
  for (const name of entries) {
    if (
      ARTIFACT_SKIP.has(name) ||
      name === WRITER_INTEGRATION_EVIDENCE ||
      name === "commit-message.txt"
    ) continue;
    const ext = extname(name);
    if (ext !== ".txt" && ext !== ".md") continue;
    try {
      textFiles.push({
        name,
        content: redactSensitiveText(readFileSync(join(runDir, name), "utf-8")),
      });
    } catch (err) {
      writeArtifactReadError(res, name, err);
      return;
    }
  }

  const artifacts: RunArtifacts = { writerIntegration, commitMessage, textFiles };
  jsonResponse(res, 200, artifacts);
}

function pathHasDirectoryEntry(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return false;
    }
    throw err;
  }
}

function writeArtifactReadError(
  res: ServerResponse,
  artifact: string,
  err: unknown,
): void {
  jsonResponse(res, 500, {
    error: "Run artifact is unreadable",
    artifact,
    message: redactSensitiveText(err instanceof Error ? err.message : String(err)),
  });
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
  const metadata = store.getRun(runId);
  if (!metadata) {
    jsonResponse(res, 404, { error: "Run not found" });
    return;
  }

  const thinking: Record<string, Array<EvidenceRedactionMarker | string>> = {};
  for (const step of metadata.steps) {
    if (step.type !== "agent") continue;
    const eventsPath = join(runDir, "steps", `${step.id}.events.jsonl`);
    const events = readStepEvents(eventsPath);
    const blocks: Array<EvidenceRedactionMarker | string> = [];
    for (const event of events) {
      if (event.type === "thinking" && event.thinking) {
        blocks.push(projectEvidenceText(event.thinking, "daemon-api", "private-reasoning"));
      }
    }
    if (blocks.length > 0) {
      thinking[step.id] = blocks;
    }
  }

  jsonResponse(res, 200, { thinking });
}
