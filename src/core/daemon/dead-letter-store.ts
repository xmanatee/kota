import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EventJsonObject } from "#core/events/event-journal.js";
import { redactSensitiveText } from "#core/evidence/policy.js";
import { writeJsonFileAtomic } from "#core/util/json-file.js";
import { enumerateWorkflowRunMetadataWithDurableAuthority } from "#core/workflow/run-operational-projection.js";
import {
  redactDeadLetterJson,
  resolveClosedDeadLetterRetention,
  resolveDeadLetterRetention,
  sanitizeDeadLetterRedriveAttempt,
  sanitizeDeadLetterRedriveSource,
  sanitizeDeadLetterSource,
  toEventJsonObject,
} from "./dead-letter-policy.js";
import type {
  DeadLetterItem,
  DeadLetterQueueCounts,
  DeadLetterQueueQuery,
  DeadLetterQueueRecordInput,
  DeadLetterRedriveAttempt,
  DeadLetterSource,
} from "./dead-letter-queue.js";

type DeadLetterQueueSnapshot = {
  items: DeadLetterItem[];
};

const STORE_FILE = "items.json";

function unionStrings(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])].sort();
}

function normalizeDeadLetterReason(reason: string): string {
  return reason
    .replace(/\b\d{4}-\d{2}-\d{2}T[0-9A-Za-z:.-]+Z-[a-z0-9-]+\b/g, "<run-id>")
    .replace(/\bdlq-[0-9a-f-]{36}\b/g, "<dlq-id>");
}

function deadLetterSourceFingerprint(source: DeadLetterSource): string {
  switch (source.kind) {
    case "workflow-dispatch":
      return JSON.stringify({
        kind: source.kind,
        workflowName: source.workflowName,
        triggerEvent: source.triggerEvent,
        triggerSchemaRef: source.triggerSchemaRef,
      });
    case "batch-envelope":
      return JSON.stringify({
        kind: source.kind,
        workflowName: source.workflowName,
        triggerIndex: source.triggerIndex,
        sourceEventName: source.sourceEventName,
        groupingKey: source.groupingKey,
      });
    case "event-envelope":
      return JSON.stringify({ kind: source.kind, eventName: source.eventName });
    case "confirmed-action-dispatch":
      return JSON.stringify({
        kind: source.kind,
        decisionId: source.decisionId,
        actionId: source.actionId,
        adapterName: source.adapterName,
        workflowName: source.workflowName,
        stepId: source.stepId,
      });
  }
}

export function deadLetterWorkflowName(item: DeadLetterItem): string | undefined {
  if (item.source.kind === "workflow-dispatch") return item.source.workflowName;
  if (item.source.kind === "batch-envelope") return item.source.workflowName;
  if (item.source.kind === "confirmed-action-dispatch") return item.source.workflowName;
  if (item.redrive.kind === "workflow") return item.redrive.workflowName;
  return item.affectedWorkflowNames[0];
}

export function deadLetterDuplicateFingerprint(item: DeadLetterItem): string {
  return JSON.stringify({
    type: item.type,
    scopeId: item.scopeId,
    owningModule: item.owningModule,
    affectedWorkflowNames: [...item.affectedWorkflowNames].sort(),
    failureClass: item.failure.lastErrorClass,
    reason: normalizeDeadLetterReason(item.failure.reason),
    source: deadLetterSourceFingerprint(item.source),
  });
}

function deadLetterRecordFingerprint(item: DeadLetterItem): string | null {
  const redrive = deadLetterRedriveFingerprint(item);
  if (redrive === null) return null;
  return JSON.stringify({ incident: deadLetterDuplicateFingerprint(item), redrive });
}

function deadLetterRedriveFingerprint(item: DeadLetterItem): object | null {
  switch (item.redrive.kind) {
    case "workflow": {
      const { source } = item.redrive;
      if (source.kind === "run-trigger") {
        return {
          kind: source.kind,
          workflowName: item.redrive.workflowName,
          runId: source.runId,
        };
      }
      if (source.kind === "event-journal") {
        return {
          kind: source.kind,
          workflowName: item.redrive.workflowName,
          eventId: source.eventId,
        };
      }
      if (source.kind === "resume-step") {
        return {
          kind: source.kind,
          workflowName: item.redrive.workflowName,
          runId: source.runId,
          stepId: source.stepId,
        };
      }
      return {
        kind: source.kind,
        workflowName: item.redrive.workflowName,
        eventIds: source.payload.inputEvents.map((event) => event.eventId).sort(),
      };
    }
    case "event":
      return { kind: item.redrive.source.kind, eventId: item.redrive.source.eventId };
    case "none":
      return null;
  }
}

/** Owns durable dead-letter capture state and status transitions. */
export class DeadLetterQueueStore {
  private readonly filePath: string;

  constructor(
    private readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, STORE_FILE);
  }

  getPath(): string {
    return this.filePath;
  }

  list(query: DeadLetterQueueQuery = {}): DeadLetterItem[] {
    let items = this.readSnapshot().items.filter((item) => !this.isExpired(item));
    if (query.status !== undefined) {
      items = items.filter((item) => item.status === query.status);
    }
    if (query.type !== undefined) {
      items = items.filter((item) => item.type === query.type);
    }
    if (query.scopeId !== undefined) {
      items = items.filter((item) => item.scopeId === query.scopeId);
    }
    if (query.workflowName !== undefined) {
      const workflowName = query.workflowName;
      items = items.filter((item) => item.affectedWorkflowNames.includes(workflowName));
    }
    items = items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (query.limit !== undefined && query.limit > 0 && items.length > query.limit) {
      return items.slice(0, query.limit);
    }
    return items;
  }

  counts(scopeId?: string): DeadLetterQueueCounts {
    const counts: DeadLetterQueueCounts = { open: 0, dismissed: 0, redriven: 0 };
    for (const item of this.list(scopeId === undefined ? {} : { scopeId })) {
      counts[item.status] += 1;
    }
    return counts;
  }

  get(id: string): DeadLetterItem | null {
    return this.list().find((item) => item.id === id) ?? null;
  }

  record(input: DeadLetterQueueRecordInput): DeadLetterItem {
    const now = input.failure.failedAt ?? this.now().toISOString();
    const item: DeadLetterItem = {
      id: `dlq-${randomUUID()}`,
      type: input.type,
      status: "open",
      scopeId: input.scopeId,
      owningModule: input.owningModule,
      sourceEventIds: [...input.sourceEventIds],
      affectedWorkflowNames: [...input.affectedWorkflowNames],
      failure: {
        reason: redactSensitiveText(input.failure.reason),
        retryCount: input.failure.retryCount ?? 1,
        lastErrorClass: input.failure.lastErrorClass,
        firstFailedAt: now,
        lastFailedAt: now,
      },
      source: sanitizeDeadLetterSource(input.source),
      redrive: sanitizeDeadLetterRedriveSource(input.redrive),
      redactedProjection: redactDeadLetterJson(input.redactedProjection),
      createdAt: now,
      updatedAt: now,
      redriveAttempts: [],
      retention: resolveDeadLetterRetention(
        input.retention,
        new Date(now),
        input.scopeId,
        "open",
      ),
    };
    const snapshot = this.readSnapshot();
    const recordFingerprint = deadLetterRecordFingerprint(item);
    const duplicateIndex = recordFingerprint === null
      ? -1
      : snapshot.items.findIndex(
          (existing) =>
            existing.status === "open" &&
            deadLetterRecordFingerprint(existing) === recordFingerprint,
        );
    if (duplicateIndex !== -1) {
      const existing = snapshot.items[duplicateIndex]!;
      const next: DeadLetterItem = {
        ...existing,
        sourceEventIds: unionStrings(existing.sourceEventIds, item.sourceEventIds),
        affectedWorkflowNames: unionStrings(
          existing.affectedWorkflowNames,
          item.affectedWorkflowNames,
        ),
        failure: {
          ...existing.failure,
          reason: item.failure.reason,
          retryCount: existing.failure.retryCount + item.failure.retryCount,
          lastErrorClass: item.failure.lastErrorClass,
          lastFailedAt: item.failure.lastFailedAt,
        },
        redactedProjection: item.redactedProjection,
        updatedAt: now,
        retention: resolveDeadLetterRetention(
          input.retention,
          new Date(now),
          input.scopeId,
          "open",
        ),
      };
      snapshot.items[duplicateIndex] = next;
      this.writeSnapshot(snapshot);
      return next;
    }
    snapshot.items.push(item);
    this.writeSnapshot(snapshot);
    return item;
  }

  dismiss(id: string, reason: string): DeadLetterItem | null {
    const snapshot = this.readSnapshot();
    const index = snapshot.items.findIndex((item) => item.id === id);
    if (index === -1) return null;
    const now = this.now().toISOString();
    const item = snapshot.items[index]!;
    const next: DeadLetterItem = {
      ...item,
      status: "dismissed",
      dismissedAt: now,
      dismissalReason: redactSensitiveText(reason),
      updatedAt: now,
      retention: resolveClosedDeadLetterRetention(item, new Date(now)),
    };
    snapshot.items[index] = next;
    this.writeSnapshot(snapshot);
    return next;
  }

  recordRedriveAttempt(
    id: string,
    attempt: Omit<DeadLetterRedriveAttempt, "attemptedAt">,
  ): DeadLetterItem | null {
    const snapshot = this.readSnapshot();
    const index = snapshot.items.findIndex((item) => item.id === id);
    if (index === -1) return null;
    const now = this.now().toISOString();
    const item = snapshot.items[index]!;
    const sanitizedAttempt = sanitizeDeadLetterRedriveAttempt({ ...attempt, attemptedAt: now });
    const nextStatus = attempt.result.status === "failed" ? item.status : "redriven";
    const next: DeadLetterItem = {
      ...item,
      status: nextStatus,
      updatedAt: now,
      redriveAttempts: [...item.redriveAttempts, sanitizedAttempt],
      retention: nextStatus === item.status
        ? item.retention
        : resolveClosedDeadLetterRetention(item, new Date(now)),
    };
    snapshot.items[index] = next;
    this.writeSnapshot(snapshot);
    return next;
  }

  diagnostics(id: string): EventJsonObject | null {
    const item = this.get(id);
    if (!item) return null;
    return toEventJsonObject({
      item,
      exportedAt: this.now().toISOString(),
      storePath: this.filePath,
    });
  }

  private readSnapshot(): DeadLetterQueueSnapshot {
    if (!existsSync(this.filePath)) return { items: [] };
    return JSON.parse(readFileSync(this.filePath, "utf-8")) as DeadLetterQueueSnapshot;
  }

  private writeSnapshot(snapshot: DeadLetterQueueSnapshot): void {
    mkdirSync(this.dir, { recursive: true });
    writeJsonFileAtomic(this.filePath, snapshot);
  }

  private isExpired(item: DeadLetterItem): boolean {
    return item.retention.kind === "expire-after-ms" &&
      Date.parse(item.retention.expiresAt) <= this.now().getTime();
  }
}

export function deadLetterStoreForScope(scopeRoot: string): DeadLetterQueueStore {
  return new DeadLetterQueueStore(join(scopeRoot, ".kota", "dead-letter-queue"));
}

export function deadLetterRunArtifactIds(
  scopeRoot: string,
  stateDir = join(scopeRoot, ".kota"),
): {
  itemIds: string[];
  runIds: string[];
} {
  const deadLetterDir = join(scopeRoot, ".kota", "dead-letter-queue");
  const deadLetterFile = join(deadLetterDir, STORE_FILE);
  const itemIds = existsSync(deadLetterFile)
    ? new DeadLetterQueueStore(deadLetterDir).list({ status: "open" }).map((item) => item.id)
    : [];
  const runsDir = join(scopeRoot, ".kota", "runs");
  const runIds: string[] = [];
  if (existsSync(runsDir)) {
    for (const run of enumerateWorkflowRunMetadataWithDurableAuthority({
      runsDir,
      stateDir,
      scopeRoot,
    }).runs) {
      if (!run.id.includes("redrive")) continue;
      runIds.push(run.id);
    }
  }
  return { itemIds, runIds };
}
