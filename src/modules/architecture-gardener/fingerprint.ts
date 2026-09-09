import { createHash } from "node:crypto";

/**
 * Deterministic JSON stringifier that sorts all object keys recursively.
 */
export function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map(
    (key) => `${JSON.stringify(key)}:${stableJsonStringify(obj[key])}`,
  );
  return `{${entries.join(",")}}`;
}

/**
 * Compute a deterministic SHA-256 fingerprint for a payload.
 */
export function computeFingerprint(payload: unknown): string {
  return createHash("sha256")
    .update(stableJsonStringify(payload))
    .digest("hex")
    .slice(0, 24);
}

/**
 * Compute stable fingerprint for an architecture observation.
 */
export function computeObservationFingerprint(args: {
  kind: string;
  targetScope: string;
  evidence: Record<string, unknown>;
}): string {
  return computeFingerprint({
    kind: args.kind,
    targetScope: args.targetScope,
    evidence: Object.fromEntries(Object.entries(args.evidence).filter(([key]) => key !== "line")),
  });
}

/**
 * Combine multiple fingerprints into a single stable fingerprint.
 */
export function combineFingerprints(fingerprints: readonly string[]): string {
  const sorted = [...fingerprints].sort();
  return createHash("sha256")
    .update(sorted.join(":"))
    .digest("hex")
    .slice(0, 24);
}
