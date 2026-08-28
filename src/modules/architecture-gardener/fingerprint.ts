import { createHash } from "node:crypto";
import type { ArchitectureObservation, ArchitectureSignal } from "./types.js";

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
    evidence: args.evidence,
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

/**
 * Check if a candidate's signals represent a material delta compared to previously seen fingerprints.
 */
export function isMaterialDelta(
  signals: readonly ArchitectureSignal[],
  previousFingerprints: Readonly<Record<string, unknown>>,
): boolean {
  if (signals.length === 0) return false;
  // If any signal's fingerprint is not present in previous fingerprints, it is a material delta
  return signals.some((signal) => !previousFingerprints[signal.fingerprint]);
}

/**
 * Group observations by target scope.
 */
export function groupObservationsByScope(
  observations: readonly ArchitectureObservation[],
): Map<string, ArchitectureObservation[]> {
  const map = new Map<string, ArchitectureObservation[]>();
  for (const obs of observations) {
    const list = map.get(obs.targetScope) ?? [];
    list.push(obs);
    map.set(obs.targetScope, list);
  }
  return map;
}
