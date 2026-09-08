import { describe, expect, it } from "vitest";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import evaluatorCalibrationNotify from "./workflow.js";

const samplePayload = {
  windowStartMs: Date.parse("2026-04-13T00:00:00.000Z"),
  windowEndMs: Date.parse("2026-04-20T00:00:00.000Z"),
  totalRuns: 20,
  passVerdictCount: 12,
  passContradictionCount: 5,
  passContradictionRate: 5 / 12,
  passContradictions: [],
  passWithWarningsCount: 3,
  passWithWarningsFollowUpCount: 1,
  passWithWarningsFollowUpRate: 1 / 3,
  thresholdRate: 0.25,
  passWithWarningsThresholdRate: 0.4,
  driftKinds: ["pass-contradiction"] as ("pass-contradiction" | "pass-with-warnings-escalation")[],
  reason:
    "Pass-verdict contradiction rate 41.7% exceeds threshold 25.0% (5 of 12 pass verdicts).",
};

describe("evaluator-calibration-notify workflow", () => {
  it("emits workflow.attention.digest carrying the contradiction rate and reason", async () => {
    const harness = new WorkflowScenarioDriver(evaluatorCalibrationNotify, {
      trigger: {
        event: "evaluator-calibration.regression.detected",
        payload: samplePayload,
      },
    });
    const result = await harness.run();
    expect(result.status).toBe("success");
    const digestEvents = result.emitted.filter(
      (e) => e.event === "workflow.attention.digest",
    );
    expect(digestEvents).toHaveLength(1);
    const digest = digestEvents[0].payload as {
      items: Array<{ label: string; detail: string }>;
      text: string;
    };
    expect(digest.items).toHaveLength(1);
    expect(digest.items[0].label).toBe("Evaluator calibration drift");
    expect(digest.items[0].detail).toContain("41.7%");
    expect(digest.items[0].detail).toContain("25.0%");
    expect(digest.items[0].detail).toContain("5/12");
    expect(digest.items[0].detail).toContain("pass-contradiction");
    expect(digest.text).toContain(samplePayload.reason);
    expect(digest.text).toContain("recorded as evidence");
  });
});
