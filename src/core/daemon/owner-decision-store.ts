import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import type {
  OwnerDecisionConsumeResult,
  OwnerDecisionConsumption,
  OwnerDecisionCreateInput,
  OwnerDecisionRecord,
  OwnerDecisionSelectedValue,
  OwnerDecisionStatus,
} from "./owner-decision-types.js";
import {
  sanitizeOwnerConfirmedActionMetadataForStorage,
  sanitizeOwnerDecisionSelectionForStorage,
  validateOwnerConfirmedActionMetadata,
  validateOwnerDecisionRequest,
  validateOwnerDecisionSelection,
} from "./owner-decision-validation.js";

export type {
  OwnerConfirmedActionMetadata,
  OwnerDecisionClientProjection,
  OwnerDecisionConsumption,
  OwnerDecisionCreateInput,
  OwnerDecisionEvidence,
  OwnerDecisionFormField,
  OwnerDecisionJsonObject,
  OwnerDecisionJsonPrimitive,
  OwnerDecisionJsonValue,
  OwnerDecisionKind,
  OwnerDecisionOption,
  OwnerDecisionRecord,
  OwnerDecisionRequest,
  OwnerDecisionRequester,
  OwnerDecisionSelectedValue,
  OwnerDecisionStatus,
} from "./owner-decision-types.js";
export {
  projectOwnerDecisionForClient,
  sanitizeOwnerConfirmedActionMetadataForStorage,
  sanitizeOwnerDecisionSelectionForStorage,
  validateOwnerConfirmedActionMetadata,
  validateOwnerDecisionRequest,
  validateOwnerDecisionSelection,
} from "./owner-decision-validation.js";

let enqueueSeq = 0;

const OWNER_DECISION_ID_PATTERN = /^[0-9a-f]{8}$/;

export function isOwnerDecisionId(id: string): boolean {
  return OWNER_DECISION_ID_PATTERN.test(id);
}

function ownerDecisionFilePath(dir: string, id: string): string | null {
  return isOwnerDecisionId(id) ? join(dir, `${id}.json`) : null;
}

function ownerDecisionFilePathForItem(dir: string, item: OwnerDecisionRecord): string {
  const path = ownerDecisionFilePath(dir, item.id);
  if (!path) throw new Error(`Malformed owner decision id: ${item.id}`);
  return path;
}

export class OwnerDecisionStore {
  private pbus: ProjectScopedEventBus | null;

  constructor(
    private dir: string,
    private scopeId: string,
    pbus?: ProjectScopedEventBus | null,
  ) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.pbus = pbus ?? null;
  }

  create(input: OwnerDecisionCreateInput): OwnerDecisionRecord {
    validateOwnerDecisionRequest(input.request);
    if (input.action !== undefined) validateOwnerConfirmedActionMetadata(input.request, input.action);
    const now = new Date().toISOString();
    const item: OwnerDecisionRecord = {
      id: randomUUID().slice(0, 8),
      seq: enqueueSeq++,
      scopeId: this.scopeId,
      status: "pending",
      request: input.request,
      requester: input.requester,
      evidence: input.evidence,
      createdAt: now,
      updatedAt: now,
      ...(input.expiresAt !== undefined && { expiresAt: input.expiresAt }),
      ...(input.action !== undefined && {
        action: sanitizeOwnerConfirmedActionMetadataForStorage(input.request, input.action),
      }),
    };
    this.write(item);
    this.emitChanged("owner.decision.requested", item);
    return item;
  }

  get(id: string): OwnerDecisionRecord | null {
    const path = ownerDecisionFilePath(this.dir, id);
    if (!path) return null;
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as OwnerDecisionRecord;
  }

  list(status?: OwnerDecisionStatus): OwnerDecisionRecord[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((file) => file.endsWith(".json") && isOwnerDecisionId(file.slice(0, -".json".length)))
      .map((file) => JSON.parse(readFileSync(join(this.dir, file), "utf-8")) as OwnerDecisionRecord)
      .filter((item) => !status || item.status === status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.seq - b.seq);
  }

  linkOwnerQuestion(id: string, ownerQuestionId: string): OwnerDecisionRecord {
    const item = this.requirePending(id);
    const updated = this.update(item, { ownerQuestionId });
    this.emitChanged("owner.decision.changed", updated);
    return updated;
  }

  answer(id: string, selectedValue: OwnerDecisionSelectedValue, resolutionSource: string): OwnerDecisionRecord | null {
    const item = this.get(id);
    if (!item || item.status !== "pending") return null;
    validateOwnerDecisionSelection(item.request, selectedValue);
    const selectedValueForStorage = sanitizeOwnerDecisionSelectionForStorage(item.request, selectedValue);
    const updated = this.update(item, {
      status: "answered",
      selectedValue: selectedValueForStorage,
      resolvedAt: new Date().toISOString(),
      resolutionSource,
    });
    this.emitChanged("owner.decision.resolved", updated);
    return updated;
  }

  cancel(id: string, reason: string, resolutionSource: string): OwnerDecisionRecord | null {
    const item = this.get(id);
    if (!item || item.status !== "pending") return null;
    const updated = this.update(item, {
      status: "canceled",
      canceledReason: reason,
      resolvedAt: new Date().toISOString(),
      resolutionSource,
    });
    this.emitChanged("owner.decision.resolved", updated);
    return updated;
  }

  expire(id: string, resolutionSource = "timeout"): OwnerDecisionRecord | null {
    const item = this.get(id);
    if (!item || item.status !== "pending") return null;
    const updated = this.update(item, {
      status: "expired",
      canceledReason: "expired",
      resolvedAt: new Date().toISOString(),
      resolutionSource,
    });
    this.emitChanged("owner.decision.resolved", updated);
    return updated;
  }

  expireStale(nowMs = Date.now()): OwnerDecisionRecord[] {
    const expired: OwnerDecisionRecord[] = [];
    for (const item of this.list("pending")) {
      if (item.expiresAt === undefined) continue;
      if (nowMs < new Date(item.expiresAt).getTime()) continue;
      const next = this.expire(item.id);
      if (next) expired.push(next);
    }
    return expired;
  }

  consumeForAction(id: string, consumption: Omit<OwnerDecisionConsumption, "consumedAt">): OwnerDecisionConsumeResult {
    const item = this.get(id);
    if (!item) return { ok: false, reason: "not_found" };
    if (item.status === "consumed") return { ok: false, reason: "already_consumed" };
    if (item.status !== "answered") return { ok: false, reason: "not_answered" };
    if (!item.action || item.action.actionId !== consumption.actionId || item.action.adapterName !== consumption.adapterName) {
      return { ok: false, reason: "action_mismatch" };
    }
    const updated = this.update(item, {
      status: "consumed",
      consumption: { ...consumption, consumedAt: new Date().toISOString() },
    });
    this.emitChanged("owner.decision.consumed", updated);
    return { ok: true, decision: updated };
  }

  clear(): void {
    if (!existsSync(this.dir)) return;
    for (const file of readdirSync(this.dir).filter((entry) => entry.endsWith(".json"))) {
      unlinkSync(join(this.dir, file));
    }
  }

  private requirePending(id: string): OwnerDecisionRecord {
    const item = this.get(id);
    if (!item || item.status !== "pending") throw new Error(`owner decision ${id} is not pending`);
    return item;
  }

  private update(item: OwnerDecisionRecord, patch: Partial<OwnerDecisionRecord>): OwnerDecisionRecord {
    const updated = { ...item, ...patch, updatedAt: new Date().toISOString() };
    this.write(updated);
    return updated;
  }

  private write(item: OwnerDecisionRecord): void {
    writeFileSync(ownerDecisionFilePathForItem(this.dir, item), JSON.stringify(item, null, 2));
  }

  private emitChanged(
    event: "owner.decision.requested" | "owner.decision.changed" | "owner.decision.resolved" | "owner.decision.consumed",
    item: OwnerDecisionRecord,
  ): void {
    if (!this.pbus) return;
    this.pbus.emit(event, {
      id: item.id,
      status: item.status,
      kind: item.request.kind,
      requesterKind: item.requester.kind,
      ownerQuestionId: item.ownerQuestionId ?? null,
      actionId: item.action?.actionId ?? null,
      workflowName: item.requester.kind === "workflow" ? item.requester.workflowName : null,
      runId: item.requester.kind === "workflow" ? item.requester.runId : null,
      pendingCount: this.list("pending").length,
    });
  }
}

let store: OwnerDecisionStore | null = null;

export function getOwnerDecisionStore(dir?: string, scopeId = "default"): OwnerDecisionStore {
  if (!store) store = new OwnerDecisionStore(dir ?? join(process.cwd(), ".kota", "owner-decisions"), scopeId);
  return store;
}

export function setOwnerDecisionStoreInstance(instance: OwnerDecisionStore): void {
  store = instance;
}

export function resetOwnerDecisionStore(): void {
  store = null;
}
