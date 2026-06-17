import { describe, expect, it } from "vitest";
import { autonomyHealthSignal } from "#modules/autonomy/health-signal.js";
import autonomyHealthReviewerWorkflow from "./workflow.js";

describe("autonomy-health-reviewer workflow", () => {
  it("reviews critical health signals immediately and batches non-critical signals by scope and labels", () => {
    const critical = autonomyHealthReviewerWorkflow.triggers.find(
      (trigger) =>
        trigger.event === autonomyHealthSignal.name &&
        trigger.filter?.severity === "critical",
    );
    const batched = autonomyHealthReviewerWorkflow.triggers.find(
      (trigger) =>
        trigger.event === autonomyHealthSignal.name &&
        trigger.batch !== undefined,
    );

    expect(critical?.batch).toBeUndefined();
    expect(batched?.filter).toEqual({ severity: ["warning", "error"] });
    expect(batched?.batch).toMatchObject({
      maxCount: 5,
      groupBy: ["scopeId", "labelsKey"],
      maxBufferSize: 20,
      overflow: "flush-oldest",
    });
  });
});
