import { describe, expect, it } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import evalHarnessRegressionNotify, {
  buildAttentionItemFromRegression,
} from "./regression-notify-workflow.js";

const samplePayload = {
  baseline: { fixtureCount: 4, repeatCount: 3, passAtK: 0.95, passHatK: 0.95 },
  candidate: { fixtureCount: 4, repeatCount: 3, passAtK: 0.9, passHatK: 0.6 },
  hostClass: "autonomy-cadence",
  noiseBandPercentagePoints: 3,
  dropPercentagePoints: 35,
  runArtifactBaseDir: "/tmp/eval-runs/2026-04-27",
  reason:
    'pass^k dropped 35pp (baseline 95.0% → candidate 60.0%) beyond 3pp noise band at stable resource profile "autonomy-cadence".',
};

describe("eval-harness-regression-notify workflow", () => {
  it("registers without errors and triggers on eval-harness.regression.detected only", () => {
    const registered = registerWorkflowDefinition(
      "src/modules/eval-harness/regression-notify-workflow.ts",
      evalHarnessRegressionNotify,
    );
    expect(registered.name).toBe("eval-harness-regression-notify");
    expect(registered.triggers).toHaveLength(1);
    expect(registered.triggers[0].event).toBe(
      "eval-harness.regression.detected",
    );
  });

  it("emits workflow.attention.digest with both baseline and candidate numbers", async () => {
    const harness = new WorkflowTestHarness(evalHarnessRegressionNotify, {
      trigger: {
        event: "eval-harness.regression.detected",
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
    expect(digest.items[0].label).toBe("Eval regression");
    expect(digest.items[0].detail).toContain("95.0%");
    expect(digest.items[0].detail).toContain("60.0%");
    expect(digest.items[0].detail).toContain("autonomy-cadence");
    expect(digest.text).toContain(samplePayload.runArtifactBaseDir);
    expect(digest.text).toContain(samplePayload.reason);
  });
});

describe("buildAttentionItemFromRegression", () => {
  it("formats pass^k as percentages and carries host class + band + drop", () => {
    const item = buildAttentionItemFromRegression(samplePayload);
    expect(item.detail).toContain("pass^k 95.0% → 60.0%");
    expect(item.detail).toContain("-35.00pp");
    expect(item.detail).toContain("3pp band");
    expect(item.detail).toContain('host "autonomy-cadence"');
  });
});
