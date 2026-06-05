import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type IdempotencyJsonPrimitive = string | number | boolean | null;
export type IdempotencyJsonValue =
  | IdempotencyJsonPrimitive
  | readonly IdempotencyJsonValue[]
  | IdempotencyJsonObject;
export type IdempotencyJsonObject = {
  [key: string]: IdempotencyJsonValue | undefined;
};

export type IdempotencyOperationType =
  | "event-ingestion"
  | "workflow-dispatch"
  | "owner-confirmed-action"
  | "provider-write";

export type IdempotencyEntryStatus =
  | "in_progress"
  | "accepted"
  | "replayed"
  | "ignored"
  | "expired"
  | "rejected";

export type IdempotencyRetentionPolicy =
  | { kind: "retain" }
  | { kind: "expire-after-ms"; durationMs: number };

export type IdempotencyEntry = {
  id: string;
  scopeId: string;
  operation: IdempotencyOperationType;
  key: string;
  parameterFingerprint: string;
  status: IdempotencyEntryStatus;
  createdAt: string;
  updatedAt: string;
  retention: IdempotencyRetentionPolicy;
  expiresAt?: string;
  expiredAt?: string;
  firstResult?: IdempotencyJsonObject;
  duplicateCount: number;
  conflictCount: number;
  lastDuplicateAt?: string;
  lastConflictAt?: string;
  conflictStatus?: "parameter_mismatch";
};

export type IdempotencyRecordInput = {
  scopeId: string;
  operation: IdempotencyOperationType;
  key: string;
  parameterFingerprint: string;
  result: IdempotencyJsonObject;
  retention?: IdempotencyRetentionPolicy;
};

export type IdempotencyClaimInput = Omit<IdempotencyRecordInput, "result">;

export type IdempotencyReservation = {
  entryId: string;
  scopeId: string;
  operation: IdempotencyOperationType;
  key: string;
  parameterFingerprint: string;
};

export type IdempotencyClaimResult =
  | {
      status: "accepted";
      entry: IdempotencyEntry;
      reservation: IdempotencyReservation;
    }
  | { status: "replayed"; entry: IdempotencyEntry; result: IdempotencyJsonObject }
  | { status: "ignored"; entry: IdempotencyEntry; reason: "in_progress" }
  | { status: "expired"; entry: IdempotencyEntry; reason: "retention_expired" }
  | { status: "rejected"; entry: IdempotencyEntry; reason: "parameter_mismatch" };

export type IdempotencyRecordResult =
  | { status: "accepted"; entry: IdempotencyEntry; result: IdempotencyJsonObject }
  | { status: "replayed"; entry: IdempotencyEntry; result: IdempotencyJsonObject }
  | { status: "ignored"; entry: IdempotencyEntry; reason: "in_progress" }
  | { status: "expired"; entry: IdempotencyEntry; reason: "retention_expired" }
  | { status: "rejected"; entry: IdempotencyEntry; reason: "parameter_mismatch" };

const DEFAULT_RETENTION: IdempotencyRetentionPolicy = {
  kind: "expire-after-ms",
  durationMs: 7 * 24 * 60 * 60 * 1000,
};
const DIGEST_PREFIX_LENGTH = 32;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashIdempotencyMaterial(
  parts: readonly IdempotencyJsonValue[],
): string {
  return digest(canonicalJson(parts)).slice(0, DIGEST_PREFIX_LENGTH);
}

export function fingerprintIdempotencyParams(
  value: IdempotencyJsonValue,
): string {
  return digest(canonicalJson(value));
}

export function toIdempotencyJsonValue(value: IdempotencyJsonValue): IdempotencyJsonValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return null;
  return JSON.parse(serialized) as IdempotencyJsonValue;
}

function canonicalJson(value: IdempotencyJsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value)
    .filter((entry): entry is [string, IdempotencyJsonValue] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

function expiresAt(policy: IdempotencyRetentionPolicy, now: Date): string | undefined {
  if (policy.kind === "retain") return undefined;
  return new Date(now.getTime() + policy.durationMs).toISOString();
}

function isExpired(entry: IdempotencyEntry, now: Date): boolean {
  return entry.expiresAt !== undefined && Date.parse(entry.expiresAt) <= now.getTime();
}

function idempotencyFileName(
  scopeId: string,
  operation: IdempotencyOperationType,
  key: string,
): string {
  return `${digest([scopeId, operation, key].join("\0"))}.json`;
}

export class IdempotencyStore {
  constructor(
    private readonly dir: string,
    private readonly defaultScopeId: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    mkdirSync(dir, { recursive: true });
  }

  getDefaultScopeId(): string {
    return this.defaultScopeId;
  }

  claim(input: IdempotencyClaimInput): IdempotencyClaimResult {
    const now = this.now();
    const existing = this.get(input.scopeId, input.operation, input.key);
    if (existing?.status === "expired") {
      return this.createReservation(input, now);
    }
    if (existing && isExpired(existing, now)) {
      return this.expireExisting(existing, now);
    }
    if (existing) {
      return this.resolveExisting(existing, input, now);
    }

    return this.createReservation(input, now);
  }

  private createReservation(
    input: IdempotencyClaimInput,
    now: Date,
  ): IdempotencyClaimResult {
    const retention = input.retention ?? DEFAULT_RETENTION;
    const expiry = expiresAt(retention, now);
    const entry: IdempotencyEntry = {
      id: randomUUID(),
      scopeId: input.scopeId,
      operation: input.operation,
      key: input.key,
      parameterFingerprint: input.parameterFingerprint,
      status: "in_progress",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      retention,
      ...(expiry !== undefined ? { expiresAt: expiry } : {}),
      duplicateCount: 0,
      conflictCount: 0,
    };
    this.write(entry);
    return {
      status: "accepted",
      entry,
      reservation: {
        entryId: entry.id,
        scopeId: entry.scopeId,
        operation: entry.operation,
        key: entry.key,
        parameterFingerprint: entry.parameterFingerprint,
      },
    };
  }

  private expireExisting(
    existing: IdempotencyEntry,
    now: Date,
  ): IdempotencyClaimResult {
    const expired: IdempotencyEntry = {
      ...existing,
      status: "expired",
      expiredAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.write(expired);
    return { status: "expired", entry: expired, reason: "retention_expired" };
  }

  complete(
    reservation: IdempotencyReservation,
    result: IdempotencyJsonObject,
  ): IdempotencyEntry {
    const existing = this.get(
      reservation.scopeId,
      reservation.operation,
      reservation.key,
    );
    if (
      !existing ||
      existing.id !== reservation.entryId ||
      existing.parameterFingerprint !== reservation.parameterFingerprint
    ) {
      throw new Error("idempotency reservation no longer owns the entry");
    }
    const updated: IdempotencyEntry = {
      ...existing,
      status: "accepted",
      firstResult: result,
      updatedAt: this.now().toISOString(),
    };
    this.write(updated);
    return updated;
  }

  record(input: IdempotencyRecordInput): IdempotencyRecordResult {
    const claim = this.claim(input);
    if (claim.status !== "accepted") return claim;
    const entry = this.complete(claim.reservation, input.result);
    return { status: "accepted", entry, result: input.result };
  }

  get(
    scopeId: string,
    operation: IdempotencyOperationType,
    key: string,
  ): IdempotencyEntry | null {
    const path = join(this.dir, idempotencyFileName(scopeId, operation, key));
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as IdempotencyEntry;
  }

  list(query?: {
    scopeId?: string;
    operation?: IdempotencyOperationType;
    status?: IdempotencyEntryStatus;
  }): IdempotencyEntry[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => JSON.parse(readFileSync(join(this.dir, file), "utf-8")) as IdempotencyEntry)
      .filter((entry) => query?.scopeId === undefined || entry.scopeId === query.scopeId)
      .filter((entry) => query?.operation === undefined || entry.operation === query.operation)
      .filter((entry) => query?.status === undefined || entry.status === query.status)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private resolveExisting(
    existing: IdempotencyEntry,
    input: IdempotencyClaimInput,
    now: Date,
  ): IdempotencyClaimResult {
    if (existing.parameterFingerprint !== input.parameterFingerprint) {
      const rejected: IdempotencyEntry = {
        ...existing,
        status: "rejected",
        conflictCount: existing.conflictCount + 1,
        conflictStatus: "parameter_mismatch",
        lastConflictAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      this.write(rejected);
      return { status: "rejected", entry: rejected, reason: "parameter_mismatch" };
    }

    if (existing.firstResult !== undefined) {
      const replayed: IdempotencyEntry = {
        ...existing,
        status: "replayed",
        duplicateCount: existing.duplicateCount + 1,
        lastDuplicateAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      this.write(replayed);
      return { status: "replayed", entry: replayed, result: existing.firstResult };
    }

    const ignored: IdempotencyEntry = {
      ...existing,
      status: "ignored",
      duplicateCount: existing.duplicateCount + 1,
      lastDuplicateAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.write(ignored);
    return { status: "ignored", entry: ignored, reason: "in_progress" };
  }

  private write(entry: IdempotencyEntry): void {
    writeFileSync(
      join(this.dir, idempotencyFileName(entry.scopeId, entry.operation, entry.key)),
      JSON.stringify(entry, null, 2),
    );
  }
}
