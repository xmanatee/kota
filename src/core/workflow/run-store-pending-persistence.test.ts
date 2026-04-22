import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BusEnvelope } from "#core/events/event-bus.js";
import { JsonFileError } from "#core/util/json-file.js";
import { buildWorkflowCompletedPayload } from "./event-payloads.js";
import { enqueueMatchingWorkflows } from "./run-executor-utils.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowQueuedRun, WorkflowRunMetadata } from "./run-types.js";
import type { WorkflowDefinition } from "./types.js";
import { registerWorkflowDefinition, validateWorkflowDefinitions } from "./validation.js";

function makeProjectDir(): string {
  const dir = join(
    tmpdir(),
    `kota-queue-persist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(join(dir, ".kota", "runs"), { recursive: true });
  return dir;
}

function attentionDigestConsumer(): WorkflowDefinition[] {
  return validateWorkflowDefinitions(
    [
      registerWorkflowDefinition("test/attention-digest.ts", {
        name: "attention-digest",
        triggers: [
          {
            event: "workflow.completed",
            filter: { tags: ["monitored"] },
          },
        ],
        steps: [
          {
            id: "note",
            type: "emit",
            event: "attention-digest.done",
          },
        ],
      }),
    ],
    process.cwd(),
  );
}

function producerMetadata(status: "success" | "interrupted"): WorkflowRunMetadata {
  return {
    id: `explorer-${status}`,
    workflow: "explorer",
    definitionPath: "src/modules/autonomy/workflows/explorer/workflow.ts",
    trigger: { event: "autonomy.queue.thin", payload: {} },
    startedAt: "2026-01-01T00:00:00.000Z",
    status,
    completedAt: "2026-01-01T00:05:00.000Z",
    durationMs: 300_000,
    runDir: `.kota/runs/explorer-${status}`,
    steps: [],
  };
}

describe("pending workflow.completed queue persistence", () => {
  let projectDir: string;
  let store: WorkflowRunStore;

  beforeEach(() => {
    projectDir = makeProjectDir();
    store = new WorkflowRunStore(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  for (const status of ["success", "interrupted"] as const) {
    it(`preserves trigger.payload.tags as an array through save and restore (${status} producer)`, () => {
      const consumers = attentionDigestConsumer();
      const completedPayload = buildWorkflowCompletedPayload(
        producerMetadata(status),
        status,
        ["monitored", "autonomy"],
      );

      const envelope: BusEnvelope = {
        type: "workflow.completed",
        payload: completedPayload as unknown as Record<string, unknown>,
      };

      const queued: WorkflowQueuedRun[] = [];
      enqueueMatchingWorkflows(envelope, consumers, (definition, _trigger, run) => {
        queued.push({
          runId: `queued-${status}`,
          workflowName: definition.name,
          trigger: run,
          enqueuedAtMs: 1000,
          notBeforeMs: 1000,
        });
      });

      expect(queued).toHaveLength(1);
      expect(queued[0].trigger.payload.tags).toEqual(["monitored", "autonomy"]);

      store.setPendingRuns(queued);

      const restored = store.readState();
      expect(restored.pendingRuns).toHaveLength(1);
      const restoredTrigger = restored.pendingRuns[0].trigger;
      expect(restoredTrigger.event).toBe("workflow.completed");
      const restoredTags = restoredTrigger.payload.tags;
      expect(Array.isArray(restoredTags)).toBe(true);
      expect(restoredTags).toEqual(["monitored", "autonomy"]);
      expect(restoredTrigger.payload.status).toBe(status);
    });
  }

  it("rejects cycles in the persisted queue with a loud error", () => {
    const cyclicPayload: Record<string, unknown> = {
      workflow: "explorer",
      runId: "explorer-bad",
      status: "interrupted",
      triggerEvent: "autonomy.queue.thin",
      durationMs: 1000,
      definitionPath: "src/modules/autonomy/workflows/explorer/workflow.ts",
      runDir: ".kota/runs/explorer-bad",
      tags: ["monitored"],
    };
    cyclicPayload.self = cyclicPayload;

    const queued: WorkflowQueuedRun[] = [
      {
        runId: "queued-bad",
        workflowName: "attention-digest",
        trigger: { event: "workflow.completed", payload: cyclicPayload },
        enqueuedAtMs: 1,
        notBeforeMs: 1,
      },
    ];

    expect(() => store.setPendingRuns(queued)).toThrow(JsonFileError);
  });
});
