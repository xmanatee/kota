import { describe, expect, it } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import evaluatorCalibrationNotify, {
  buildAttentionItemFromCalibration,
} from "./workflow.js";

const samplePayload = {
  windowStartMs: Date.parse("2026-04-13T00:00:00.000Z"),
  windowEndMs: Date.parse("2026-04-20T00:00:00.000Z"),
  totalRuns: 20,
  passVerdictCount: 12,
  passContradictionCount: 5,
  passContradictionRate: 5 / 12,
  passWithWarningsCount: 3,
  passWithWarningsFollowUpCount: 1,
  passWithWarningsFollowUpRate: 1 / 3,
  thresholdRate: 0.25,
  passWithWarningsThresholdRate: 0.4,
  driftKinds: ["pass-contradiction"] as ("pass-contradiction" | "pass-with-warnings-escalation")[],
  repairAction: "created" as "noop" | "created" | "recreated" | "promoted" | "skipped",
  reason:
    "Pass-verdict contradiction rate 41.7% exceeds threshold 25.0% (5 of 12 pass verdicts).",
};

describe("evaluator-calibration-notify workflow", () => {
  it("registers with a single trigger on the typed calibration regression event", () => {
    const registered = registerWorkflowDefinition(
      "src/modules/autonomy/workflows/evaluator-calibration-notify/workflow.ts",
      evaluatorCalibrationNotify,
    );
    expect(registered.name).toBe("evaluator-calibration-notify");
    expect(registered.triggers).toHaveLength(1);
    expect(registered.triggers[0].event).toBe(
      "evaluator-calibration.regression.detected",
    );
  });

  it("emits workflow.attention.digest carrying the contradiction rate and reason", async () => {
    const harness = new WorkflowTestHarness(evaluatorCalibrationNotify, {
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
    expect(digest.text).toContain("Corrective action:");
  });
});

describe("buildAttentionItemFromCalibration", () => {
  it("formats rates as percentages and references the contradiction ratio", () => {
    const item = buildAttentionItemFromCalibration(samplePayload);
    expect(item.detail).toContain("41.7%");
    expect(item.detail).toContain("25.0%");
    expect(item.detail).toContain("(5/12)");
    expect(item.detail).toContain("pass-contradiction");
    expect(item.text).toContain("opened a new repair task");
  });

  it("describes a noop corrective action when the repair task is already in flight", () => {
    const item = buildAttentionItemFromCalibration({
      ...samplePayload,
      repairAction: "noop",
    });
    expect(item.text).toContain("already in flight");
  });
});
