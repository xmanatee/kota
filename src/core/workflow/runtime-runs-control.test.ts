import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import type { WorkflowQueuedRun } from "./run-types.js";
import {
  redriveDeadLetter,
  type WorkflowRuntimeRunsControlState,
} from "./runtime-runs-control.js";

const tempDirs: string[] = [];

function redriveFixture(appendRun: (run: WorkflowQueuedRun) => ReturnType<WorkflowRuntimeRunsControlState["wfQueue"]["appendRun"]>) {
  const root = mkdtempSync(join(tmpdir(), "kota-redrive-admission-"));
  tempDirs.push(root);
  const deadLetterQueue = new DeadLetterQueueStore(root);
  const sourceRunId = "source-run";
  const item = deadLetterQueue.record({
    type: "workflow-dispatch",
    scopeId: "scope-a",
    owningModule: "test",
    sourceEventIds: ["event-original"],
    affectedWorkflowNames: ["target-workflow"],
    failure: {
      reason: "fixture failure",
      lastErrorClass: "execution",
    },
    source: {
      kind: "workflow-dispatch",
      workflowName: "target-workflow",
      triggerEvent: "fixture.event",
      triggerSchemaRef: null,
      failedRunId: sourceRunId,
    },
    redrive: {
      kind: "workflow",
      workflowName: "target-workflow",
      source: { kind: "run-trigger", runId: sourceRunId },
    },
    redactedProjection: {},
  });
  const refill = vi.fn();
  const state = {
    deadLetterQueue,
    definitions: [{ name: "target-workflow", enabled: true }],
    store: {
      getRun: () => ({
        trigger: {
          event: "fixture.event",
          schemaRef: null,
          eventId: "event-original",
          payload: { idempotencyKey: "original-delivery", value: "preserved" },
        },
      }),
    },
    wfQueue: { appendRun },
    stopping: false,
    dispatchPaused: false,
    runCoordinator: { refill },
  } as unknown as WorkflowRuntimeRunsControlState;
  return { state, item, deadLetterQueue, refill };
}

afterEach(() => {
  for (const root of tempDirs.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("dead-letter workflow redrive admission", () => {
  it("admits a redrive with a fresh durable identity", () => {
    let admitted: WorkflowQueuedRun | undefined;
    const fixture = redriveFixture((run) => {
      admitted = run;
      return { status: "admitted", runId: run.runId! };
    });

    const result = redriveDeadLetter(
      fixture.state,
      fixture.item.id,
      "retry after repair",
      "original",
    );

    expect(result).toMatchObject({ ok: true, workflowName: "target-workflow" });
    expect(admitted?.trigger).toMatchObject({
      event: "fixture.event",
      payload: {
        value: "preserved",
        redriveOf: fixture.item.id,
        idempotencyKey: expect.stringContaining(`dead-letter-redrive:${fixture.item.id}:`),
      },
    });
    expect(admitted?.trigger.eventId).toBeUndefined();
    expect(fixture.refill).toHaveBeenCalledOnce();
  });

  it("keeps the item open and reports a rejected admission", () => {
    const fixture = redriveFixture(() => null);

    expect(
      redriveDeadLetter(
        fixture.state,
        fixture.item.id,
        "retry after repair",
        "original",
      ),
    ).toEqual({ ok: false, reason: "admission_rejected" });
    expect(fixture.deadLetterQueue.get(fixture.item.id)).toMatchObject({
      status: "open",
      redriveAttempts: [
        {
          result: {
            status: "failed",
            message: "workflow redrive admission was rejected",
          },
        },
      ],
    });
    expect(fixture.refill).not.toHaveBeenCalled();
  });
});
