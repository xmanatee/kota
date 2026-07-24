import { describe, expect, it } from "vitest";
import {
  type AutonomyHealthSignalInput,
  normalizeHealthSignal,
  stableHealthSignalId,
} from "./health-signal.js";

const baseSignal: AutonomyHealthSignalInput = {
  source: {
    kind: "workflow",
    id: "builder",
  },
  severity: "warning",
  labels: ["runtime", "custom-new-label", "runtime"],
  summary: "Builder had a recoverable runtime warning.",
  evidenceRefs: [
    {
      kind: "run",
      ref: ".kota/runs/run-1/metadata.json",
      summary: "builder run run-1",
    },
  ],
  actionability: "local-code",
  dedupeKey: "workflow:builder:runtime-warning",
  observationCount: 1,
  createdAt: "2026-06-17T12:00:00.000Z",
};

describe("autonomy health signal contract", () => {
  it("normalizes labels without rejecting unknown label values", () => {
    const signal = normalizeHealthSignal(baseSignal);

    expect(signal.labels).toEqual([
      "custom-new-label",
      "runtime",
    ]);
    expect(signal.labelsKey).toBe("custom-new-label,runtime");
    expect(signal.signalId).toBe(stableHealthSignalId(baseSignal));
  });

  it("rejects signals without evidence references", () => {
    expect(() =>
      normalizeHealthSignal({
        ...baseSignal,
        evidenceRefs: [],
      }),
    ).toThrow(/at least one evidence ref/);
  });

  it("rejects malformed dedupe keys", () => {
    expect(() =>
      normalizeHealthSignal({
        ...baseSignal,
        dedupeKey: "workflow builder runtime warning",
      }),
    ).toThrow(/dedupeKey/);
  });

  it("rejects malformed severity and actionability values", () => {
    expect(() =>
      normalizeHealthSignal({
        ...baseSignal,
        severity: "bad" as AutonomyHealthSignalInput["severity"],
      }),
    ).toThrow(/severity/);

    expect(() =>
      normalizeHealthSignal({
        ...baseSignal,
        actionability: "bad" as AutonomyHealthSignalInput["actionability"],
      }),
    ).toThrow(/actionability/);
  });

  it("requires a positive observation count", () => {
    expect(() =>
      normalizeHealthSignal({
        ...baseSignal,
        observationCount: 0,
      }),
    ).toThrow(/observationCount/);
  });
});
