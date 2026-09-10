import { basename, join } from "node:path";
import {
  deriveDirectoryScopeId,
  GLOBAL_SCOPE_ID,
  loadRegistryFileFromDisk,
} from "#core/daemon/scope-registry.js";
import {
  WORKFLOW_BATCH_FLUSH_EVENT,
  type WorkflowBatchFlushPayload,
  type WorkflowRunTrigger,
} from "#core/workflow/trigger-types.js";
import {
  automaticProgressReviewRequested,
  progressReviewRequested,
} from "../events.js";
import { systemicWindowSchema } from "../systemic-evidence.js";
import { PROGRESS_REVIEW_DEFAULT_WINDOW_MS } from "./constants.js";
import type {
  ProgressReviewDirectorySource,
  ProgressReviewEvidencePacket,
  ProgressReviewEvidenceTarget,
  ProgressReviewRequestPayload,
  ProgressReviewScope,
  ProgressReviewTriggerKind,
} from "./types.js";

export function nonEmptyString(value: string | undefined): string | null {
  return value && value.trim().length > 0 ? value.trim() : null;
}

export function readWindowMs(payload: ProgressReviewRequestPayload): number {
  if (payload.windowMs === undefined) return PROGRESS_REVIEW_DEFAULT_WINDOW_MS;
  if (!Number.isFinite(payload.windowMs) || payload.windowMs <= 0) {
    throw new Error("progress-review windowMs must be a positive number when provided");
  }
  return Math.floor(payload.windowMs);
}

export function progressEvidenceWindow(payload: ProgressReviewRequestPayload, now: Date) {
  if (!payload.evidenceWindow) {
    const maxAgeMs = readWindowMs(payload);
    return { startedAt: new Date(now.getTime() - maxAgeMs).toISOString(), endedAt: now.toISOString(), maxAgeMs };
  }
  const pinned = systemicWindowSchema.parse(payload.evidenceWindow);
  const oldest = [...pinned.baseline, ...pinned.current].reduce((time, run) => Math.min(time, Date.parse(run.startedAt)), Date.parse(pinned.startedAt));
  return { startedAt: new Date(oldest).toISOString(), endedAt: pinned.endedAt, maxAgeMs: Date.parse(pinned.endedAt) - oldest };
}

export function requestPayload(trigger: WorkflowRunTrigger): ProgressReviewRequestPayload {
  return trigger.payload as ProgressReviewRequestPayload;
}

export function currentDirectorySource(
  workspaceRoot: string,
  scopeRoot: string,
  stateDir: string,
  runtimeStateDir: string,
): ProgressReviewDirectorySource {
  return {
    scopeId: deriveDirectoryScopeId(scopeRoot),
    displayName: basename(scopeRoot),
    workspaceRoot,
    scopeRoot,
    stateDir,
    authorityStateDir: runtimeStateDir,
    idPrefix: "",
  };
}

export function loadConfiguredDirectorySources(
  stateDir: string,
): { sources: ProgressReviewDirectorySource[] } | null {
  const registry = loadRegistryFileFromDisk(stateDir);
  if (!registry) return null;
  return {
    sources: registry.scopes.map((scope) => ({
      scopeId: scope.scopeId,
      displayName: scope.displayName,
      workspaceRoot: scope.scopeRoot,
      scopeRoot: scope.scopeRoot,
      stateDir: join(scope.scopeRoot, ".kota"),
      authorityStateDir: stateDir,
      idPrefix: "",
    })),
  };
}

export function prefixGlobalSourceIds(
  source: ProgressReviewDirectorySource,
): ProgressReviewDirectorySource {
  return {
    ...source,
    idPrefix: `scope:${source.scopeId}:`,
  };
}

export function selectEvidenceTarget(
  workspaceRoot: string,
  scopeRoot: string,
  trigger: WorkflowRunTrigger,
  stateDir: string,
  runtimeStateDir: string,
): ProgressReviewEvidenceTarget {
  const payload = requestPayload(trigger);
  const selected = nonEmptyString(payload.scopeId);
  const currentSource = currentDirectorySource(workspaceRoot, scopeRoot, stateDir, runtimeStateDir);
  const configured = loadConfiguredDirectorySources(runtimeStateDir);
  const scopeId = selected ?? currentSource.scopeId;
  if (scopeId === GLOBAL_SCOPE_ID) {
    if (!configured) {
      throw new Error(
        "progress-review global scope requires scope-registry.json in the active state directory",
      );
    }
    return {
      scope: {
        kind: "global",
        scopeId,
        displayName: "Global",
      },
      sources: configured.sources.map(prefixGlobalSourceIds),
    };
  }

  const sources = configured?.sources ?? [currentSource];
  let source = sources.find((entry) => entry.scopeId === scopeId);
  if (!source) {
    throw new Error(`progress-review scopeId ${scopeId} is not configured`);
  }
  if (scopeId === currentSource.scopeId) {
    source = { ...source, workspaceRoot, stateDir };
  }
  return {
    scope: {
      kind: "directory",
      scopeId,
      displayName: source.displayName,
      directoryRoot: source.scopeRoot,
    },
    sources: [source],
  };
}

export function sourceEvidenceId(source: ProgressReviewDirectorySource, id: string): string {
  return `${source.idPrefix}${id}`;
}

export function sourceSummary(source: ProgressReviewDirectorySource, summary: string): string {
  return source.idPrefix ? `[${source.displayName}] ${summary}` : summary;
}

export function batchPayload(trigger: WorkflowRunTrigger): WorkflowBatchFlushPayload | null {
  if (trigger.event !== WORKFLOW_BATCH_FLUSH_EVENT) return null;
  const payload = trigger.payload as Partial<WorkflowBatchFlushPayload>;
  if (
    typeof payload.sourceEventName !== "string" ||
    typeof payload.reason !== "string" ||
    typeof payload.count !== "number" ||
    typeof payload.groupingKey !== "string" ||
    !Array.isArray(payload.inputEvents) ||
    !payload.batch
  ) {
    throw new Error("progress-review batch trigger payload is malformed");
  }
  return payload as WorkflowBatchFlushPayload;
}

export function classifyProgressReviewTrigger(
  trigger: WorkflowRunTrigger,
): ProgressReviewTriggerKind {
  if (
    trigger.event === progressReviewRequested.name ||
    trigger.event === automaticProgressReviewRequested.name
  ) {
    return trigger.payload.automatic === true ? "semantic-boundary" : "manual";
  }
  if (trigger.event === "schedule") return "schedule";

  const batch = batchPayload(trigger);
  if (!batch) return "event-batch";
  if (batch.sourceEventName === "workflow.completed") return "run-count";
  if (batch.sourceEventName === "inbound.signal.received") return "message-batch";
  return "event-batch";
}

export function summarizePayload(value: object): string {
  const text = JSON.stringify(value);
  if (text.length <= 240) return text;
  return `${text.slice(0, 237)}...`;
}

export function eventScopeId(payload: WorkflowRunTrigger["payload"]): string | null {
  if (typeof payload.scopeId === "string") return payload.scopeId;
  return null;
}

export function batchSummary(trigger: WorkflowRunTrigger): ProgressReviewEvidencePacket["batch"] {
  const batch = batchPayload(trigger);
  if (!batch) return null;
  return {
    sourceEventName: batch.sourceEventName,
    reason: batch.reason,
    count: batch.count,
    inputEventCount: batch.inputEvents.length,
    groupingKey: batch.groupingKey,
    droppedInputCount: batch.batch.droppedInputCount,
    journalBackfillCount: 0,
  };
}

export function directoryScopeForSource(
  source: ProgressReviewDirectorySource,
): ProgressReviewScope {
  return {
    kind: "directory",
    scopeId: source.scopeId,
    displayName: source.displayName,
    directoryRoot: source.scopeRoot,
  };
}
