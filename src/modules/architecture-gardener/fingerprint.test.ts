
import { describe, expect, it } from "vitest";
import {
  combineFingerprints,
  computeFingerprint,
  stableJsonStringify,
} from "./fingerprint.js";

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

});
