import { describe, expect, it } from "vitest";
import { buildRetriggerOptions } from "./retrigger.js";

const original = {
  event: "autonomy.builder.recovery.requested",
  schemaRef: { name: "builder-recovery", version: 1 },
  payload: {
    taskId: "task-ui",
    _runId: "old-run",
    triggeredAt: "old-time",
    retryOf: "older-retry",
    replayOf: "older-replay",
    replayTriggeredAt: "older-replay-time",
    resumedFromRunId: "older-resume",
    resumeFromStep: "build",
    resumeTriggeredAt: "older-resume-time",
  },
};

describe("buildRetriggerOptions", () => {
  it("builds a retry without changing the source event", () => {
    const options = buildRetriggerOptions("retry", "failed-run", "builder", original);

    expect(options).toMatchObject({
      event: original.event,
      schemaRef: original.schemaRef,
      payload: { taskId: "task-ui", retryOf: "failed-run" },
    });
    expect(options.runId).toContain("-builder-");
    expect(options.payload).not.toHaveProperty("replayOf");
    expect(options.payload).not.toHaveProperty("resumedFromRunId");
    expect(options.payload).not.toHaveProperty("triggeredAt");
  });

  it("builds a full replay without retry checkpoint state", () => {
    const options = buildRetriggerOptions("replay", "source-run", "builder", original);

    expect(options.payload).toEqual({ taskId: "task-ui", replayOf: "source-run" });
  });
});
