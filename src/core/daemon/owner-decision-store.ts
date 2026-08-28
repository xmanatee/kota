import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ScopedEventBus } from "#core/events/scope.js";
import { redactSensitiveText } from "#core/evidence/policy.js";
import {
  OwnerDecisionRecordRepository,
} from "./owner-decision-record-repository.js";
import {
  OwnerDecisionRecordStorage,
} from "./owner-decision-record-storage.js";
import {
  OwnerDecisionResolutionAuthenticator,
} from "./owner-decision-resolution-integrity.js";
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
  sanitizeOwnerDecisionEvidenceForStorage,
  sanitizeOwnerDecisionRecordForStorage,
  sanitizeOwnerDecisionRequesterForStorage,
  sanitizeOwnerDecisionRequestForStorage,
  sanitizeOwnerDecisionSelectionForStorage,
  validateOwnerConfirmedActionMetadata,
  validateOwnerDecisionRequest,
  validateOwnerDecisionSelection,
} from "./owner-decision-validation.js";

export {
  isOwnerDecisionId,
  OwnerDecisionRecordRepository,
  ownerDecisionFilePath,
} from "./owner-decision-record-repository.js";
export {
  type OwnerDecisionFileIdentity,
  type OwnerDecisionRecordSnapshot,
  OwnerDecisionRecordStorage,
} from "./owner-decision-record-storage.js";
export {
  isOwnerDecisionResolutionIntegrity,
  isTerminalOwnerDecisionStatus,
  OwnerDecisionResolutionAuthenticator,
  type OwnerDecisionResolutionIntegrity,
  OwnerDecisionResolutionIntegrityError,
} from "./owner-decision-resolution-integrity.js";
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
  sanitizeOwnerDecisionEvidenceForStorage,
  sanitizeOwnerDecisionRecordForStorage,
  sanitizeOwnerDecisionRequesterForStorage,
  sanitizeOwnerDecisionRequestForStorage,
  sanitizeOwnerDecisionSelectionForStorage,
  validateOwnerConfirmedActionMetadata,
  validateOwnerDecisionRequest,
  validateOwnerDecisionSelection,
} from "./owner-decision-validation.js";

let enqueueSeq = 0;

export type OwnerDecisionStoreOptions = {
  clock?: () => Date;
  authenticator?: OwnerDecisionResolutionAuthenticator;
};

export class OwnerDecisionStore {
  readonly storage: OwnerDecisionRecordStorage;
  readonly repository: OwnerDecisionRecordRepository;
  readonly authenticator: OwnerDecisionResolutionAuthenticator;
  private readonly clock: () => Date;
  private pbus: ScopedEventBus | null;
  readonly scopeId: string;

  constructor(
    dirOrStorage: string | OwnerDecisionRecordStorage,
    scopeId: string,
    pbus?: ScopedEventBus | null,
    options?: OwnerDecisionStoreOptions,
  ) {
    this.scopeId = scopeId;
    this.storage =
      typeof dirOrStorage === "string"
        ? new OwnerDecisionRecordStorage(dirOrStorage)
        : dirOrStorage;
    this.repository = new OwnerDecisionRecordRepository(this.storage, scopeId);
    this.authenticator = options?.authenticator ?? new OwnerDecisionResolutionAuthenticator();
    this.clock = options?.clock ?? (() => new Date());
    this.pbus = pbus ?? null;
    this.recoverPendingSnapshots();
  }

  get directoryPath(): string {
    return this.storage.directoryPath;
  }

  create(input: OwnerDecisionCreateInput): OwnerDecisionRecord {
    validateOwnerDecisionRequest(input.request);
    if (input.action !== undefined) {
      validateOwnerConfirmedActionMetadata(input.request, input.action);
    }
    const now = this.clock().toISOString();
    const request = sanitizeOwnerDecisionRequestForStorage(input.request);
    const item = sanitizeOwnerDecisionRecordForStorage({
      id: randomUUID().slice(0, 8),
      seq: enqueueSeq++,
      revision: 1,
      scopeId: this.scopeId,
      status: "pending",
      request,
      requester: sanitizeOwnerDecisionRequesterForStorage(input.requester),
      evidence: sanitizeOwnerDecisionEvidenceForStorage(input.evidence),
      createdAt: now,
      updatedAt: now,
      ...(input.expiresAt !== undefined && { expiresAt: input.expiresAt }),
      ...(input.action !== undefined && {
        action: sanitizeOwnerConfirmedActionMetadataForStorage(input.request, input.action),
      }),
    });
    this.authenticator.registerPending(item);
    this.repository.write(item, null);
    this.emitChanged("owner.decision.requested", item);
    return item;
  }

  get(id: string): OwnerDecisionRecord | null {
    return this.authenticator.read(this.repository, id);
  }

  getWithAuthenticatedResolution(id: string): OwnerDecisionRecord | null {
    return this.get(id);
  }

  list(status?: OwnerDecisionStatus): OwnerDecisionRecord[] {
    return this.repository.list(status).map((stored) => {
      if (stored.item.status === "pending") {
        this.authenticator.assertPendingAuthentic(stored.item);
      } else {
        this.authenticator.assertValid(stored.item, stored.resolutionIntegrity);
      }
      return stored.item;
    });
  }

  linkOwnerQuestion(id: string, ownerQuestionId: string): OwnerDecisionRecord {
    const stored = this.repository.read(id);
    if (!stored || stored.item.status !== "pending") {
      throw new Error(`owner decision ${id} is not pending`);
    }
    this.authenticator.assertPendingAuthentic(stored.item);
    const updated: OwnerDecisionRecord = {
      ...stored.item,
      ownerQuestionId,
      revision: stored.item.revision + 1,
      updatedAt: this.clock().toISOString(),
    };
    this.authenticator.registerPending(updated);
    this.repository.write(updated, stored.identity);
    this.emitChanged("owner.decision.changed", updated);
    return updated;
  }

  answer(
    id: string,
    selectedValue: OwnerDecisionSelectedValue,
    resolutionSource: string,
  ): OwnerDecisionRecord | null {
    const stored = this.repository.read(id);
    if (!stored || stored.item.status !== "pending") return null;
    this.authenticator.assertPendingAuthentic(stored.item);
    validateOwnerDecisionSelection(stored.item.request, selectedValue);
    const selectedValueForStorage = sanitizeOwnerDecisionSelectionForStorage(
      stored.item.request,
      selectedValue,
    );
    const now = this.clock().toISOString();
    const updated: OwnerDecisionRecord = {
      ...stored.item,
      status: "answered",
      selectedValue: selectedValueForStorage,
      resolvedAt: now,
      resolutionSource: redactSensitiveText(resolutionSource),
      revision: stored.item.revision + 1,
      updatedAt: now,
    };
    const written = this.authenticator.write(this.repository, updated, stored.identity);
    this.emitChanged("owner.decision.resolved", written);
    return written;
  }

  cancel(
    id: string,
    reason: string,
    resolutionSource: string,
  ): OwnerDecisionRecord | null {
    const stored = this.repository.read(id);
    if (!stored || stored.item.status !== "pending") return null;
    this.authenticator.assertPendingAuthentic(stored.item);
    const now = this.clock().toISOString();
    const updated: OwnerDecisionRecord = {
      ...stored.item,
      status: "canceled",
      canceledReason: redactSensitiveText(reason),
      resolvedAt: now,
      resolutionSource: redactSensitiveText(resolutionSource),
      revision: stored.item.revision + 1,
      updatedAt: now,
    };
    const written = this.authenticator.write(this.repository, updated, stored.identity);
    this.emitChanged("owner.decision.resolved", written);
    return written;
  }

  expire(id: string, resolutionSource = "timeout"): OwnerDecisionRecord | null {
    const stored = this.repository.read(id);
    if (!stored || stored.item.status !== "pending") return null;
    this.authenticator.assertPendingAuthentic(stored.item);
    const now = this.clock().toISOString();
    const updated: OwnerDecisionRecord = {
      ...stored.item,
      status: "expired",
      canceledReason: "expired",
      resolvedAt: now,
      resolutionSource: redactSensitiveText(resolutionSource),
      revision: stored.item.revision + 1,
      updatedAt: now,
    };
    const written = this.authenticator.write(this.repository, updated, stored.identity);
    this.emitChanged("owner.decision.resolved", written);
    return written;
  }

  expireStale(nowMs?: number): OwnerDecisionRecord[] {
    const cutoff = nowMs ?? this.clock().getTime();
    const expired: OwnerDecisionRecord[] = [];
    for (const stored of this.repository.list("pending")) {
      if (stored.item.expiresAt === undefined) continue;
      if (cutoff < new Date(stored.item.expiresAt).getTime()) continue;
      const next = this.expire(stored.item.id);
      if (next) expired.push(next);
    }
    return expired;
  }

  consumeForAction(
    id: string,
    consumption: Omit<OwnerDecisionConsumption, "consumedAt">,
  ): OwnerDecisionConsumeResult {
    const stored = this.repository.read(id);
    if (!stored) return { ok: false, reason: "not_found" };
    if (stored.item.status === "consumed") {
      const existing = stored.item.consumption;
      if (
        existing &&
        existing.actionId === consumption.actionId &&
        existing.adapterName === consumption.adapterName &&
        existing.workflowName === consumption.workflowName &&
        existing.runId === consumption.runId &&
        existing.stepId === consumption.stepId &&
        existing.approvalId === (consumption.approvalId ?? null)
      ) {
        return { ok: true, decision: stored.item };
      }
      return { ok: false, reason: "already_consumed" };
    }
    if (stored.item.status !== "answered") return { ok: false, reason: "not_answered" };
    this.authenticator.assertValid(stored.item, stored.resolutionIntegrity);
    if (
      !stored.item.action ||
      stored.item.action.actionId !== consumption.actionId ||
      stored.item.action.adapterName !== consumption.adapterName
    ) {
      return { ok: false, reason: "action_mismatch" };
    }
    const now = this.clock().toISOString();
    const updated: OwnerDecisionRecord = {
      ...stored.item,
      status: "consumed",
      consumption: {
        ...consumption,
        approvalId: consumption.approvalId ?? null,
        consumedAt: now,
      },
      revision: stored.item.revision + 1,
      updatedAt: now,
    };
    const written = this.authenticator.write(this.repository, updated, stored.identity);
    this.emitChanged("owner.decision.consumed", written);
    return { ok: true, decision: written };
  }

  clear(): void {
    this.repository.clear();
    this.authenticator.clear();
  }

  private recoverPendingSnapshots(): void {
    try {
      for (const stored of this.repository.list("pending")) {
        this.authenticator.registerPending(stored.item);
      }
    } catch {
      // Clean start if repository is empty or not yet initialized
    }
  }

  private emitChanged(
    event:
      | "owner.decision.requested"
      | "owner.decision.changed"
      | "owner.decision.resolved"
      | "owner.decision.consumed",
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
      pendingCount: this.repository.list("pending").length,
    });
  }
}

let store: OwnerDecisionStore | null = null;

export function getOwnerDecisionStore(dir?: string, scopeId = "default"): OwnerDecisionStore {
  if (!store) {
    store = new OwnerDecisionStore(
      dir ?? join(process.cwd(), ".kota", "owner-decisions"),
      scopeId,
    );
  }
  return store;
}

export function setOwnerDecisionStoreInstance(instance: OwnerDecisionStore): void {
  store = instance;
}

export function resetOwnerDecisionStore(): void {
  store = null;
}
