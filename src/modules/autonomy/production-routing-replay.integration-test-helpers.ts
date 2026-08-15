import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeadLetterItem } from "#core/daemon/dead-letter-queue.js";
import type { BusEnvelope } from "#core/events/event-bus.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import autonomyModule from "./index.js";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const CAPTURE_DIR = join(
  REPO_ROOT,
  ".kota/runs/2026-08-13T10-59-08-563Z-builder-tq9ibo/evidence/artifacts/production-routing-source",
);
export const REMOVED_ESCALATORS = [
  "owner-intervention-escalator",
  "review-scrutiny-escalator",
  "trajectory-diagnostic-escalator",
  "workflow-failure-escalator",
] as const;

export type CompletionRow = {
  order: number;
  eventId: string;
  occurredAt: string;
  workflow: string;
  runId: string;
  status: "success" | "failed" | "interrupted";
  triggerEvent: string;
  durationMs: number;
  definitionPath: string;
  tags: string[];
};

export type CompletionCapture = {
  rows: CompletionRow[];
  verification: {
    rowCount: number;
    rowSha256: string;
    workflowCounts: Record<string, number>;
    removedEscalatorRuns: number;
  };
};

type DeadLetterDisposition = {
  id: string;
  failedRunId: string;
  before: { status: "open"; at: string };
  after: { status: "dismissed"; at: string; reason: string };
};

export type DeadLetterCapture = {
  records: DeadLetterItem[];
  dispositions: DeadLetterDisposition[];
  verification: {
    recordCount: number;
    allTerminal: boolean;
    repairCommit: string;
    successfulProductionRuns: string[];
  };
};

export type RoutedInvocation = {
  workflow: string;
  triggerEvent: string;
  sourceOrders: number[];
  sourceRunIds: string[];
};

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

export async function autonomyWorkflowInputs(): Promise<
  RegisteredWorkflowDefinitionInput[]
> {
  const workflows = autonomyModule.workflows;
  if (!workflows || typeof workflows !== "function") {
    throw new Error("autonomy module must expose workflow contributions");
  }
  return [...await workflows({} as never)] as RegisteredWorkflowDefinitionInput[];
}

export function completionEnvelope(
  row: CompletionRow,
  scopeId: string,
): BusEnvelope {
  return {
    type: "workflow.completed",
    schemaRef: null,
    eventId: row.eventId,
    payload: {
      scopeId,
      projectId: scopeId,
      workflow: row.workflow,
      runId: row.runId,
      status: row.status,
      triggerEvent: row.triggerEvent,
      durationMs: row.durationMs,
      runDir: `.kota/runs/${row.runId}`,
      tags: row.tags,
      sourceOrder: row.order,
    },
  };
}

export function invocationFromTrigger(
  workflow: string,
  trigger: WorkflowRunTrigger,
): RoutedInvocation {
  const inputEvents = Array.isArray(trigger.payload.inputEvents)
    ? trigger.payload.inputEvents
    : [];
  if (inputEvents.length === 0) {
    return {
      workflow,
      triggerEvent: trigger.event,
      sourceOrders:
        typeof trigger.payload.sourceOrder === "number"
          ? [trigger.payload.sourceOrder]
          : [],
      sourceRunIds:
        typeof trigger.payload.runId === "string" ? [trigger.payload.runId] : [],
    };
  }
  const payloads = inputEvents.flatMap((entry) => {
    if (
      entry === null ||
      typeof entry !== "object" ||
      !("payload" in entry) ||
      entry.payload === null ||
      typeof entry.payload !== "object"
    ) {
      return [];
    }
    return [entry.payload];
  });
  return {
    workflow,
    triggerEvent: trigger.event,
    sourceOrders: payloads.flatMap((payload) =>
      "sourceOrder" in payload && typeof payload.sourceOrder === "number"
        ? [payload.sourceOrder]
        : []
    ),
    sourceRunIds: payloads.flatMap((payload) =>
      "runId" in payload && typeof payload.runId === "string"
        ? [payload.runId]
        : []
    ),
  };
}

export function asOpenDeadLetter(
  record: DeadLetterItem,
  openedAt: string,
): DeadLetterItem {
  const { dismissedAt: _dismissedAt, dismissalReason: _dismissalReason, ...base } =
    record;
  return {
    ...base,
    status: "open",
    updatedAt: openedAt,
  };
}

export function writeDeadLetterSnapshot(
  projectDir: string,
  items: DeadLetterItem[],
): void {
  const dir = join(projectDir, ".kota", "dead-letter-queue");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "items.json"),
    `${JSON.stringify({ items }, null, 2)}\n`,
    "utf-8",
  );
}
