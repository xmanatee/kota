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

export function requestPayload(trigger: WorkflowRunTrigger): ProgressReviewRequestPayload {
  return trigger.payload as ProgressReviewRequestPayload;
}

export function currentDirectorySource(projectDir: string): ProgressReviewDirectorySource {
  return {
    scopeId: deriveDirectoryScopeId(projectDir),
    displayName: basename(projectDir),
    projectDir,
    idPrefix: "",
  };
}

export function loadConfiguredDirectorySources(
  stateDir: string,
): { sources: ProgressReviewDirectorySource[] } | null {
  const registry = loadRegistryFileFromDisk(stateDir);
  if (!registry) return null;
  return {
    sources: registry.projects.map((project) => ({
      scopeId: project.projectId,
      displayName: project.displayName,
      projectDir: project.projectDir,
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
  projectDir: string,
  trigger: WorkflowRunTrigger,
  stateDir = join(projectDir, ".kota"),
): ProgressReviewEvidenceTarget {
  const payload = requestPayload(trigger);
  const selected = nonEmptyString(payload.scopeId) ?? nonEmptyString(payload.projectId);
  const currentSource = currentDirectorySource(projectDir);
  const configured = loadConfiguredDirectorySources(stateDir);
  const scopeId = selected ?? currentSource.scopeId;
  if (scopeId === GLOBAL_SCOPE_ID) {
    if (!configured) {
      throw new Error(
        "progress-review global scope requires project-registry.json in the active state directory",
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
  const source = sources.find((entry) => entry.scopeId === scopeId);
  if (!source) {
    throw new Error(`progress-review scopeId ${scopeId} is not configured`);
  }
  return {
    scope: {
      kind: "directory",
      scopeId,
      displayName: source.displayName,
      directoryRoot: source.projectDir,
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
  if (batch.sourceEventName === "workflow.build.committed") return "task-count";
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
  if (typeof payload.projectId === "string") return payload.projectId;
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
    directoryRoot: source.projectDir,
  };
}
