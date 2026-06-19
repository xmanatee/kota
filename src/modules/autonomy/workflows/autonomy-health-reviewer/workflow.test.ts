import { describe, expect, it } from "vitest";
import { autonomyHealthSignal } from "#modules/autonomy/health-signal.js";
import autonomyHealthReviewerWorkflow from "./workflow.js";

describe("autonomy-health-reviewer workflow", () => {
  it("reviews health signals and audits persisted runtime evidence on a cadence", () => {
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
    const runtimeAudit = autonomyHealthReviewerWorkflow.triggers.find(
      (trigger) => trigger.event === "autonomy.runtime-health.audit.scheduled",
    );
    const recovery = autonomyHealthReviewerWorkflow.triggers.find(
      (trigger) => trigger.event === "runtime.recovered",
    );

    expect(critical?.batch).toBeUndefined();
    expect(batched?.filter).toEqual({ severity: ["warning", "error"] });
    expect(batched?.batch).toMatchObject({
      maxCount: 5,
      groupBy: ["scopeId", "labelsKey"],
      maxBufferSize: 20,
      overflow: "flush-oldest",
    });
    expect(runtimeAudit).toMatchObject({
      intervalMs: 6 * 60 * 60 * 1000,
      cooldownMs: 60 * 60 * 1000,
    });
    expect(recovery).toBeDefined();
  });
});
