import { describe, expect, it } from "vitest";
import { evaluateAdmission } from "./admission.js";
import type { ArchitectureSignal } from "./types.js";

function makeSignal(overrides: Partial<ArchitectureSignal> = {}): ArchitectureSignal {
  return {
    id: `sig-${Math.random().toString(36).slice(2)}`,
    kind: "structural-violation",
    category: "dependency-boundary",
    targetScope: "module:foo",
    summary: "Structural boundary violation",
    fingerprint: `fp-${Math.random().toString(36).slice(2)}`,
    evidence: {},
    ...overrides,
  };
}

describe("Architecture Gardener Admission Gate", () => {
  it("rejects when only a single advisory metric is present", () => {
    const advisorySignal = makeSignal({
      kind: "advisory-metric",
      category: "complexity",
      summary: "File complexity exceeds threshold",
      fingerprint: "fp-adv-1",
    });

    const result = evaluateAdmission({
      targetScope: "module:foo",
      signals: [advisorySignal],
    });

    expect(result.admitted).toBe(false);
    expect(result.disposition).toBe("rejected");
    expect(result.reason).toContain("Single advisory metric is insufficient");
  });

  it("admits when two independent eligible signals are present", () => {
    const sig1 = makeSignal({
      kind: "advisory-metric",
      summary: "Metric 1",
      fingerprint: "fp-1",
    });
    const sig2 = makeSignal({
      kind: "advisory-metric",
      summary: "Metric 2",
      fingerprint: "fp-2",
    });

    const result = evaluateAdmission({
      targetScope: "module:foo",
      signals: [sig1, sig2],
    });

    expect(result.admitted).toBe(true);
    expect(result.disposition).toBe("accepted");
    expect(result.eligibleSignalCount).toBe(2);
  });

  it("admits on structural violations", () => {
    const violation = makeSignal({
      kind: "structural-violation",
      summary: "Forbidden core-to-module dependency",
      fingerprint: "fp-viol-1",
    });

    const result = evaluateAdmission({
      targetScope: "src/core/router.ts",
      signals: [violation],
    });

    expect(result.admitted).toBe(true);
    expect(result.disposition).toBe("accepted");
  });

  it("admits explicit owner requests directly", () => {
    const result = evaluateAdmission({
      targetScope: "module:bar",
      signals: [],
      explicitRequest: {
        targetScope: "module:bar",
        reason: "Owner requested refactor",
      },
    });

    expect(result.admitted).toBe(true);
    expect(result.disposition).toBe("accepted");
    expect(result.reason).toContain("Explicit owner request");
  });

  it("suppresses unchanged evidence via stable fingerprints", () => {
    const sig = makeSignal({
      kind: "structural-violation",
      fingerprint: "known-fingerprint-abc",
    });

    const result = evaluateAdmission({
      targetScope: "module:foo",
      signals: [sig],
      storedFingerprints: {
        "known-fingerprint-abc": {
          firstSeenAt: "2026-08-20T00:00:00Z",
          lastSeenAt: "2026-08-27T00:00:00Z",
          targetScope: "module:foo",
          observationKind: "undeclared-runtime-cross-module-import",
        },
      },
    });

    expect(result.admitted).toBe(false);
    expect(result.disposition).toBe("suppressed");
    expect(result.reason).toContain("Unchanged evidence suppressed");
  });

  it("suppresses targets on active cooldown", () => {
    const sig = makeSignal({
      kind: "structural-violation",
      fingerprint: "fp-new",
    });

    const future = new Date(Date.now() + 3600000).toISOString();
    const result = evaluateAdmission({
      targetScope: "module:foo",
      signals: [sig],
      cooldownExpiry: future,
    });

    expect(result.admitted).toBe(false);
    expect(result.disposition).toBe("cooled_down");
    expect(result.reason).toContain("cooldown");
  });

  it("deduplicates targets with active implementation tasks", () => {
    const sig = makeSignal({
      kind: "structural-violation",
      fingerprint: "fp-new",
    });

    const result = evaluateAdmission({
      targetScope: "module:foo",
      signals: [sig],
      hasActiveTask: true,
      activeTaskId: "task-existing-123",
    });

    expect(result.admitted).toBe(false);
    expect(result.disposition).toBe("deduplicated");
    expect(result.reason).toContain("already has an active implementation task");
  });
});
