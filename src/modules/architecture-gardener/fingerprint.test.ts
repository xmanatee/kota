
import { describe, expect, it } from "vitest";
import {
  combineFingerprints,
  computeFingerprint,
  isMaterialDelta,
  stableJsonStringify,
} from "./fingerprint.js";
import type { ArchitectureSignal } from "./types.js";

describe("Architecture Gardener Fingerprint & Delta Checks", () => {
  it("stableJsonStringify produces identical strings regardless of key order", () => {
    const objA = { z: 1, a: 2, m: { y: "hello", b: "world" } };
    const objB = { a: 2, m: { b: "world", y: "hello" }, z: 1 };
    expect(stableJsonStringify(objA)).toBe(stableJsonStringify(objB));
    expect(computeFingerprint(objA)).toBe(computeFingerprint(objB));
  });

  it("combineFingerprints is order-independent", () => {
    const fps1 = ["fp-c", "fp-a", "fp-b"];
    const fps2 = ["fp-b", "fp-c", "fp-a"];
    expect(combineFingerprints(fps1)).toBe(combineFingerprints(fps2));
  });

  it("isMaterialDelta identifies new signals not in stored fingerprints", () => {
    const knownFp = "known-fp-1";
    const newFp = "new-fp-2";
    const stored = { [knownFp]: { firstSeenAt: "now", lastSeenAt: "now", targetScope: "mod", observationKind: "forbidden-core-to-module-dependency" as const } };
    const unchangedSignals: ArchitectureSignal[] = [
      {
        id: "s1",
        kind: "structural-violation",
        category: "dependency-boundary",
        targetScope: "mod",
        summary: "s1",
        fingerprint: knownFp,
        evidence: {},
      },
    ];
    const changedSignals: ArchitectureSignal[] = [
      ...unchangedSignals,
      {
        id: "s2",
        kind: "structural-violation",
        category: "dependency-boundary",
        targetScope: "mod",
        summary: "s2",
        fingerprint: newFp,
        evidence: {},
      },
    ];
    expect(isMaterialDelta(unchangedSignals, stored)).toBe(false);
    expect(isMaterialDelta(changedSignals, stored)).toBe(true);
  });
});
