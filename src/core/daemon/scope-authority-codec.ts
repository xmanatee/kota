import {
  SCOPE_AUTHORITY_SCHEMA_VERSION,
  type ScopeAuthorityAuditRecord,
  type ScopeAuthorityMetadata,
  type ScopeAuthorityMutation,
} from "./scope-authority-types.js";
import type { ScopePolicyArea } from "./scope-policy.js";
import { decodeScopePolicyFragment } from "./scope-policy-codec.js";

type BoundaryValue = unknown;
type BoundaryObject = { [key: string]: BoundaryValue };

export type ScopeAuthorityDecodeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const POLICY_AREAS = [
  "autonomy",
  "writes",
  "channels",
  "setup",
  "ownerConfirmation",
  "retention",
  "modules",
  "externalEffects",
] as const satisfies readonly ScopePolicyArea[];

export function decodeScopeAuthorityMutation(
  raw: BoundaryValue,
): ScopeAuthorityDecodeResult<ScopeAuthorityMutation> {
  try {
    const obj = objectValue(raw, "authority mutation");
    assertKeys(obj, "authority mutation", [
      "expectedRevision",
      "reason",
      "trust",
      "policy",
    ]);
    const expectedRevision = nonNegativeInteger(
      obj.expectedRevision,
      "authority mutation.expectedRevision",
    );
    const reason = requiredString(obj.reason, "authority mutation.reason");
    if (obj.trust !== undefined && typeof obj.trust !== "boolean") {
      throw new Error("authority mutation.trust must be a boolean when present");
    }
    let policy: ScopeAuthorityMutation["policy"];
    if (obj.policy === null) {
      policy = null;
    } else if (obj.policy !== undefined) {
      const decoded = decodeScopePolicyFragment(obj.policy);
      if (!decoded.ok) throw new Error(decoded.error);
      policy = decoded.value;
    }
    if (obj.trust === undefined && policy === undefined) {
      throw new Error("authority mutation must include trust or policy");
    }
    return {
      ok: true,
      value: {
        expectedRevision,
        reason,
        ...(typeof obj.trust === "boolean" ? { trust: obj.trust } : {}),
        ...(policy !== undefined ? { policy } : {}),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function decodeScopeAuthorityMetadata(
  raw: BoundaryValue,
): ScopeAuthorityDecodeResult<ScopeAuthorityMetadata> {
  try {
    if (raw === undefined) {
      return {
        ok: true,
        value: { schema: SCOPE_AUTHORITY_SCHEMA_VERSION, revision: 0, audit: [] },
      };
    }
    const obj = objectValue(raw, "scopeAuthority");
    assertKeys(obj, "scopeAuthority", ["schema", "revision", "audit"]);
    if (obj.schema !== SCOPE_AUTHORITY_SCHEMA_VERSION) {
      throw new Error(`scopeAuthority.schema must be ${SCOPE_AUTHORITY_SCHEMA_VERSION}`);
    }
    const revision = nonNegativeInteger(obj.revision, "scopeAuthority.revision");
    if (!Array.isArray(obj.audit)) throw new Error("scopeAuthority.audit must be an array");
    const audit = obj.audit.map((entry, index) => parseAudit(entry, index));
    const revisions = new Set(audit.map((entry) => entry.revision));
    if (revisions.size !== audit.length) {
      throw new Error("scopeAuthority.audit contains duplicate revisions");
    }
    if (audit.some((entry) => entry.revision > revision)) {
      throw new Error("scopeAuthority.audit contains a revision newer than scopeAuthority.revision");
    }
    return {
      ok: true,
      value: { schema: SCOPE_AUTHORITY_SCHEMA_VERSION, revision, audit },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function parseAudit(raw: BoundaryValue, index: number): ScopeAuthorityAuditRecord {
  const path = `scopeAuthority.audit[${index}]`;
  const obj = objectValue(raw, path);
  assertKeys(obj, path, [
    "id",
    "revision",
    "scopeId",
    "changedAt",
    "actor",
    "reason",
    "trust",
    "policy",
  ]);
  if (obj.actor !== "operator") throw new Error(`${path}.actor must be operator`);
  const trust = objectValue(obj.trust, `${path}.trust`);
  assertKeys(trust, `${path}.trust`, ["before", "after"]);
  if (typeof trust.before !== "boolean" || typeof trust.after !== "boolean") {
    throw new Error(`${path}.trust before and after must be booleans`);
  }
  const policy = objectValue(obj.policy, `${path}.policy`);
  assertKeys(policy, `${path}.policy`, ["operation", "dangerousWideningAreas"]);
  if (
    policy.operation !== "set" &&
    policy.operation !== "clear" &&
    policy.operation !== "unchanged"
  ) throw new Error(`${path}.policy.operation is invalid`);
  return {
    id: requiredString(obj.id, `${path}.id`),
    revision: positiveInteger(obj.revision, `${path}.revision`),
    scopeId: requiredString(obj.scopeId, `${path}.scopeId`),
    changedAt: requiredIsoDate(obj.changedAt, `${path}.changedAt`),
    actor: "operator",
    reason: requiredString(obj.reason, `${path}.reason`),
    trust: { before: trust.before, after: trust.after },
    policy: {
      operation: policy.operation,
      dangerousWideningAreas: enumArray(
        policy.dangerousWideningAreas,
        `${path}.policy.dangerousWideningAreas`,
        POLICY_AREAS,
      ),
    },
  };
}

function objectValue(raw: BoundaryValue, path: string): BoundaryObject {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${path} must be an object`);
  }
  return raw as BoundaryObject;
}

function requiredString(raw: BoundaryValue, path: string): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return raw;
}

function requiredIsoDate(raw: BoundaryValue, path: string): string {
  const value = requiredString(raw, path);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${path} must be an ISO date`);
  return value;
}

function nonNegativeInteger(raw: BoundaryValue, path: string): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
    throw new Error(`${path} must be a non-negative integer`);
  }
  return raw;
}

function positiveInteger(raw: BoundaryValue, path: string): number {
  const value = nonNegativeInteger(raw, path);
  if (value === 0) throw new Error(`${path} must be positive`);
  return value;
}

function enumArray<T extends string>(
  raw: BoundaryValue,
  path: string,
  values: readonly T[],
): T[] {
  if (!Array.isArray(raw)) throw new Error(`${path} must be an array`);
  const out = raw.map((entry, index) => {
    if (typeof entry !== "string" || !values.includes(entry as T)) {
      throw new Error(`${path}[${index}] is invalid`);
    }
    return entry as T;
  });
  if (new Set(out).size !== out.length) throw new Error(`${path} contains duplicates`);
  return out;
}

function assertKeys(obj: BoundaryObject, path: string, allowed: readonly string[]): void {
  const unexpected = Object.keys(obj).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) throw new Error(`${path} has unknown field ${unexpected}`);
}
