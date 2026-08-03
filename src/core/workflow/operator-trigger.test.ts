import { describe, expect, it } from "vitest";
import {
  buildOperatorQueuedRun,
  buildOperatorTriggerRequestBody,
} from "./operator-trigger.js";

describe("buildOperatorQueuedRun", () => {
  it("builds the canonical manual trigger", () => {
    const queued = buildOperatorQueuedRun("builder", {}, 1_700_000_000_000);

    expect(queued).toMatchObject({
      workflowName: "builder",
      trigger: {
        event: "manual",
        schemaRef: null,
        payload: {
          triggeredAt: "2023-11-14T22:13:20.000Z",
        },
      },
      enqueuedAtMs: 1_700_000_000_000,
      notBeforeMs: 1_700_000_000_000,
    });
  });

  it("preserves explicit trigger semantics while owning internal fields", () => {
    const queued = buildOperatorQueuedRun("builder", {
      event: "autonomy.builder.recovery.requested",
      schemaRef: { name: "builder-recovery", version: 1 },
      runId: "run-recovery-1",
      notBeforeMs: 1_700_000_010_000,
      tags: ["recovery"],
      payload: {
        taskId: "task-ui",
        triggeredAt: "stale",
        _runId: "stale-run",
      },
    }, 1_700_000_000_000);

    expect(queued).toEqual({
      runId: "run-recovery-1",
      workflowName: "builder",
      trigger: {
        event: "autonomy.builder.recovery.requested",
        schemaRef: { name: "builder-recovery", version: 1 },
        payload: {
          taskId: "task-ui",
          triggeredAt: "2023-11-14T22:13:20.000Z",
          tags: ["recovery"],
        },
      },
      enqueuedAtMs: 1_700_000_000_000,
      notBeforeMs: 1_700_000_010_000,
    });
  });

  it("serializes the same enqueue options for the daemon boundary", () => {
    expect(buildOperatorTriggerRequestBody("builder", {
      event: "runtime.idle",
      schemaRef: null,
      runId: "run-1",
      notBeforeMs: 123,
      payload: { taskId: "task-1" },
    })).toEqual({
      name: "builder",
      event: "runtime.idle",
      schemaRef: null,
      runId: "run-1",
      notBeforeMs: 123,
      payload: { taskId: "task-1" },
    });
  });
});
