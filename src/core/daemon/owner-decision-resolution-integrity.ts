import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { OwnerDecisionRecordRepository } from "./owner-decision-record-repository.js";
import type { OwnerDecisionFileIdentity } from "./owner-decision-record-storage.js";
import type { OwnerDecisionRecord } from "./owner-decision-types.js";
import { sanitizeOwnerDecisionRecordForStorage } from "./owner-decision-validation.js";

const KEY_ID_PATTERN = /^[0-9a-f]{32}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export type OwnerDecisionResolutionIntegrity = {
  version: 1;
  algorithm: "hmac-sha256";
  keyId: string;
  digest: string;
};

export function isTerminalOwnerDecisionStatus(
  status: OwnerDecisionRecord["status"],
): boolean {
  return status !== "pending";
}

export function isOwnerDecisionResolutionIntegrity(
  value: unknown,
): value is OwnerDecisionResolutionIntegrity {
  return (
    value !== undefined &&
    value !== null &&
    typeof value === "object" &&
    (value as OwnerDecisionResolutionIntegrity).version === 1 &&
    (value as OwnerDecisionResolutionIntegrity).algorithm === "hmac-sha256" &&
    typeof (value as OwnerDecisionResolutionIntegrity).keyId === "string" &&
    KEY_ID_PATTERN.test((value as OwnerDecisionResolutionIntegrity).keyId) &&
    typeof (value as OwnerDecisionResolutionIntegrity).digest === "string" &&
    DIGEST_PATTERN.test((value as OwnerDecisionResolutionIntegrity).digest)
  );
}

export class OwnerDecisionResolutionIntegrityError extends Error {
  constructor(
    decisionId: string,
    readonly reason:
      | "pending_integrity_unavailable"
      | "pending_snapshot_mismatch"
      | "terminal_resolution_invalid" = "terminal_resolution_invalid",
  ) {
    super(
      `Owner decision ${decisionId} integrity cannot authenticate its pending snapshot or terminal resolution for this daemon lifetime: ${reason}`,
    );
    this.name = "OwnerDecisionResolutionIntegrityError";
  }
}

function payload(item: OwnerDecisionRecord): string {
  const { resolutionIntegrity: _, ...rest } = item as OwnerDecisionRecord & { resolutionIntegrity?: unknown };
  return JSON.stringify(sanitizeOwnerDecisionRecordForStorage(rest as OwnerDecisionRecord));
}

type AuthenticatedPendingSnapshot = {
  digest: string;
  item: OwnerDecisionRecord;
};

export class OwnerDecisionResolutionAuthenticator {
  private readonly key = randomBytes(32);
  private readonly keyId = randomBytes(16).toString("hex");
  private readonly pendingSnapshots = new Map<string, AuthenticatedPendingSnapshot>();

  registerPending(item: OwnerDecisionRecord): void {
    if (isTerminalOwnerDecisionStatus(item.status)) {
      throw new Error(`Cannot register terminal owner decision ${item.id} as pending`);
    }
    const snapshot = structuredClone(sanitizeOwnerDecisionRecordForStorage(item));
    this.pendingSnapshots.set(item.id, {
      digest: this.digest(snapshot),
      item: snapshot,
    });
  }

  authenticatePending(item: OwnerDecisionRecord): OwnerDecisionRecord {
    const expected = this.pendingSnapshots.get(item.id);
    if (isTerminalOwnerDecisionStatus(item.status) || expected === undefined) {
      throw new OwnerDecisionResolutionIntegrityError(
        item.id,
        "pending_integrity_unavailable",
      );
    }
    if (!this.digestsMatch(expected.digest, this.digest(item))) {
      throw new OwnerDecisionResolutionIntegrityError(
        item.id,
        "pending_snapshot_mismatch",
      );
    }
    return structuredClone(expected.item);
  }

  assertPendingAuthentic(item: OwnerDecisionRecord): void {
    this.authenticatePending(item);
  }

  create(item: OwnerDecisionRecord): OwnerDecisionResolutionIntegrity {
    if (!isTerminalOwnerDecisionStatus(item.status)) {
      throw new Error(`Cannot authenticate pending owner decision ${item.id}`);
    }
    return {
      version: 1,
      algorithm: "hmac-sha256",
      keyId: this.keyId,
      digest: this.digest(item),
    };
  }

  read(
    records: OwnerDecisionRecordRepository,
    id: string,
  ): OwnerDecisionRecord | null {
    const stored = records.read(id);
    if (stored === null) return null;
    if (stored.item.status === "pending") {
      this.assertPendingAuthentic(stored.item);
    } else {
      this.assertValid(stored.item, stored.resolutionIntegrity);
    }
    return stored.item;
  }

  write(
    records: OwnerDecisionRecordRepository,
    item: OwnerDecisionRecord,
    expectedIdentity: OwnerDecisionFileIdentity | null,
  ): OwnerDecisionRecord {
    const integrity = isTerminalOwnerDecisionStatus(item.status)
      ? this.create(item)
      : undefined;
    const stored = records.write(item, expectedIdentity, integrity);
    if (isTerminalOwnerDecisionStatus(item.status)) {
      this.pendingSnapshots.delete(item.id);
    } else {
      this.registerPending(stored);
    }
    return stored;
  }

  clear(): void {
    this.pendingSnapshots.clear();
  }

  assertValid(
    item: OwnerDecisionRecord,
    integrity: OwnerDecisionResolutionIntegrity | undefined,
  ): void {
    if (
      !isTerminalOwnerDecisionStatus(item.status) ||
      !isOwnerDecisionResolutionIntegrity(integrity) ||
      integrity.keyId !== this.keyId
    ) {
      throw new OwnerDecisionResolutionIntegrityError(item.id);
    }
    if (!this.digestsMatch(this.digest(item), integrity.digest)) {
      throw new OwnerDecisionResolutionIntegrityError(item.id);
    }
  }

  private digest(item: OwnerDecisionRecord): string {
    return createHmac("sha256", this.key).update(payload(item)).digest("hex");
  }

  private digestsMatch(expected: string, actual: string): boolean {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
  }
}
