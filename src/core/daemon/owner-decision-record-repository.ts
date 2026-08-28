import { join } from "node:path";
import type {
  OwnerDecisionFileIdentity,
  OwnerDecisionRecordSnapshot,
  OwnerDecisionRecordStorage,
} from "./owner-decision-record-storage.js";
import {
  isOwnerDecisionResolutionIntegrity,
  isTerminalOwnerDecisionStatus,
  type OwnerDecisionResolutionIntegrity,
} from "./owner-decision-resolution-integrity.js";
import type {
  OwnerDecisionRecord,
  OwnerDecisionStatus,
} from "./owner-decision-types.js";
import { sanitizeOwnerDecisionRecordForStorage } from "./owner-decision-validation.js";

const OWNER_DECISION_ID_PATTERN = /^[0-9a-f]{8}$/;

export function isOwnerDecisionId(id: string): boolean {
  return OWNER_DECISION_ID_PATTERN.test(id);
}

export function ownerDecisionFilePath(dir: string, id: string): string | null {
  return isOwnerDecisionId(id) ? join(dir, `${id}.json`) : null;
}

export type StoredOwnerDecision = {
  item: OwnerDecisionRecord;
  identity: OwnerDecisionFileIdentity;
  resolutionIntegrity?: OwnerDecisionResolutionIntegrity;
};

type PersistedOwnerDecisionRecord = OwnerDecisionRecord & {
  resolutionIntegrity?: OwnerDecisionResolutionIntegrity;
};

export class OwnerDecisionRecordRepository {
  constructor(
    readonly storage: OwnerDecisionRecordStorage,
    private readonly scopeId: string,
  ) {}

  read(id: string): StoredOwnerDecision | null {
    if (!isOwnerDecisionId(id)) return null;
    const snapshot = this.storage.read(`${id}.json`);
    return snapshot === null
      ? null
      : { ...this.parse(snapshot), identity: snapshot.identity };
  }

  list(status?: OwnerDecisionStatus): StoredOwnerDecision[] {
    const stored = this.storage.list().map((snapshot) => ({
      ...this.parse(snapshot),
      identity: snapshot.identity,
    }));
    const mismatched = stored.find(({ item }) => item.scopeId !== this.scopeId);
    if (mismatched) {
      throw new Error(
        `Owner decision ${mismatched.item.id} belongs to scope ${mismatched.item.scopeId}, not ${this.scopeId}`,
      );
    }
    return stored
      .filter(({ item }) => !status || item.status === status)
      .sort(
        ({ item: left }, { item: right }) =>
          left.createdAt.localeCompare(right.createdAt) || (left.seq ?? 0) - (right.seq ?? 0),
      );
  }

  write(
    item: OwnerDecisionRecord,
    expectedIdentity: OwnerDecisionFileIdentity | null,
    resolutionIntegrity?: OwnerDecisionResolutionIntegrity,
  ): OwnerDecisionRecord {
    const projected = sanitizeOwnerDecisionRecordForStorage(item);
    if (!isOwnerDecisionId(projected.id)) {
      throw new Error(`Malformed owner decision id: ${projected.id}`);
    }
    if (isTerminalOwnerDecisionStatus(projected.status) !== (resolutionIntegrity !== undefined)) {
      throw new Error(
        `Owner decision ${projected.id} terminal state and resolution integrity must be persisted together`,
      );
    }
    const record: PersistedOwnerDecisionRecord = {
      ...projected,
      ...(resolutionIntegrity !== undefined ? { resolutionIntegrity } : {}),
    };
    this.storage.write(`${projected.id}.json`, JSON.stringify(record, null, 2), expectedIdentity);
    return projected;
  }

  clear(): void {
    this.storage.clear();
  }

  private parse(
    snapshot: OwnerDecisionRecordSnapshot,
  ): { item: OwnerDecisionRecord; resolutionIntegrity?: OwnerDecisionResolutionIntegrity } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(snapshot.contents);
    } catch {
      throw new Error(`Corrupted owner decision JSON: ${snapshot.filename}`);
    }
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      typeof (parsed as Record<string, unknown>).id !== "string" ||
      typeof (parsed as Record<string, unknown>).status !== "string"
    ) {
      throw new Error(`Invalid owner decision record shape: ${snapshot.filename}`);
    }
    const record = parsed as PersistedOwnerDecisionRecord;
    const { resolutionIntegrity, ...rest } = record;
    if (resolutionIntegrity !== undefined && !isOwnerDecisionResolutionIntegrity(resolutionIntegrity)) {
      throw new Error(`Invalid resolution integrity payload: ${snapshot.filename}`);
    }
    return {
      item: rest as OwnerDecisionRecord,
      ...(resolutionIntegrity !== undefined ? { resolutionIntegrity } : {}),
    };
  }
}
