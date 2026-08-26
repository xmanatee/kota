import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import {
  type EventEnvelope,
  EventJournal,
  type EventJournalRetentionPolicy,
  type EventJsonObject,
} from "#core/events/event-journal.js";
import {
  WORKFLOW_BATCH_FLUSH_EVENT,
  type WorkflowBatchFlushPayload,
} from "#core/workflow/trigger-types.js";
import { collectProgressReviewEvidence } from "../progress-review.js";

export const NOW = new Date("2026-06-04T12:00:00.000Z");
export const DROPPED_AT = "2026-06-04T11:50:00.000Z";
export const LIVE_AT = "2026-06-04T11:59:00.000Z";

const TASK_STATES = ["backlog", "ready", "doing", "blocked", "done", "dropped"];
const tempDirs: string[] = [];

export type ReviewBatchCase = {
  sourceEventName: string;
  triggerIndex: number;
  rawSecret?: string;
  droppedPayload: EventJsonObject;
  livePayload: EventJsonObject;
};

function makeTempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `kota-${label}-`));
  tempDirs.push(dir);
  return dir;
}

export function cleanupTempDirs(): void {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function makeScopeRoot(label: string): string {
  const dir = makeTempDir(label);
  for (const state of TASK_STATES) {
    const stateDir = join(dir, "data", "tasks", state);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "AGENTS.md"), `# ${state}\n`);
  }
  return dir;
}

export function makeStateDir(label: string): string {
  return makeTempDir(`${label}-state`);
}

export function appendJournalEvent(args: {
  workspaceRoot: string;
  stateDir?: string;
  event: string;
  receivedAt: string;
  payload: EventJsonObject;
  retention?: EventJournalRetentionPolicy;
}): EventEnvelope {
  const stateDir = args.stateDir ?? join(args.workspaceRoot, ".kota");
  const journal = new EventJournal(join(stateDir, "events"), {
    now: () => new Date(args.receivedAt),
    ...(args.retention ? { retention: args.retention } : {}),
  });
  return journal.appendFromBusEnvelope({
    type: args.event,
    schemaRef: null,
    payload: { ...args.payload, receivedAt: args.receivedAt },
  });
}

export function batchPayload(args: {
  workspaceRoot: string;
  sourceEventName?: string;
  triggerIndex?: number;
  liveEnvelope?: EventEnvelope;
  livePayload?: EventJsonObject;
}): WorkflowBatchFlushPayload {
  const scopeId = deriveDirectoryScopeId(args.workspaceRoot);
  const sourceEventName = args.sourceEventName ?? "workflow.completed";
  const liveInput =
    args.liveEnvelope && args.livePayload
      ? {
          event: sourceEventName,
          schemaRef: null,
          eventId: args.liveEnvelope.id,
          receivedAt: LIVE_AT,
          payload: { ...args.livePayload, receivedAt: LIVE_AT },
        }
      : null;
  return {
    scopeId,
    sourceEventName,
    groupingKey: `scopeId=${scopeId}`,
    reason: liveInput ? "count" : "overflow",
    count: liveInput ? 1 : 0,
    window: {
      firstEventAt: DROPPED_AT,
      lastEventAt: LIVE_AT,
      flushedAt: NOW.toISOString(),
    },
    inputEvents: liveInput ? [liveInput] : [],
    batch: {
      workflow: "progress-reviewer",
      triggerIndex: args.triggerIndex ?? 2,
      maxBufferSize: 1,
      overflow: "drop-newest",
      droppedInputCount: 1,
    },
  };
}

export function collectFromBatch(
  workspaceRoot: string,
  payload: WorkflowBatchFlushPayload,
  options: { stateDir?: string; eventJournal?: EventJournal } = {},
) {
  const stateDir = options.stateDir ?? join(workspaceRoot, ".kota");
  return collectProgressReviewEvidence({
    workspaceRoot,
    scopeRoot: workspaceRoot,
    stateDir,
    eventJournal: options.eventJournal,
    trigger: {
      event: WORKFLOW_BATCH_FLUSH_EVENT,
      schemaRef: null,
      payload,
    },
    now: NOW,
  });
}

export function reviewBatchCases(scopeId: string): ReviewBatchCase[] {
  return [
    {
      sourceEventName: "workflow.completed",
      triggerIndex: 2,
      droppedPayload: {
        scopeId,
        workflow: "builder",
        runId: "dropped-builder-run",
        status: "success",
        triggerEvent: "autonomy.queue.available",
      },
      livePayload: {
        scopeId,
        workflow: "builder",
        runId: "live-builder-run",
        status: "success",
        triggerEvent: "autonomy.queue.available",
      },
    },
    {
      sourceEventName: "inbound.signal.received",
      triggerIndex: 4,
      rawSecret: "raw-token-should-not-leak",
      droppedPayload: {
        scopeId,
        provider: "slack",
        channel: "slack",
        sourceId: "C123",
        externalId: "dropped-message",
        accessToken: "raw-token-should-not-leak",
        body: { kind: "message", format: "plain", text: "dropped message" },
      },
      livePayload: {
        scopeId,
        provider: "slack",
        channel: "slack",
        sourceId: "C123",
        externalId: "live-message",
        body: { kind: "message", format: "plain", text: "live message" },
      },
    },
  ];
}
