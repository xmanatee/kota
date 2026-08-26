import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunCoordinator } from "./run-coordinator.js";
import { RunStateDatabase } from "./run-state-database.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";
import { registerWorkflowDefinition, validateWorkflowDefinitions } from "./validation.js";
import { WorkflowQueueManager } from "./workflow-queue.js";

const PROJECT_ID = "project-queue-restoration";

function trigger(
  event: string,
  payload: Record<string, unknown>,
): WorkflowRunTrigger {
  return { event, schemaRef: null, payload };
}

function workflow(projectDir: string): WorkflowDefinition {
  return validateWorkflowDefinitions(
    [
      registerWorkflowDefinition("test/workflow.ts", {
        name: "semantic-review",
        repository: "read",
        triggers: [{ event: "review.changed", queueMode: "all" }],
        inputSchema: {
          type: "object",
          required: ["taskId", "revision"],
          properties: {
            taskId: { type: "string" },
            revision: { type: "number" },
          },
        },
        resources: ({ trigger: runTrigger }) => [
          `task:${String(runTrigger.payload.taskId)}`,
        ],
        triggerAdmission: ({ trigger: runTrigger }) =>
          runTrigger.event === "manual" || runTrigger.payload.revision !== 0
            ? { admitted: true }
            : { admitted: false, reason: "revision was already consumed" },
        steps: [{ id: "noop", type: "code", run: () => ({ ok: true }) }],
      }),
    ],
    projectDir,
  )[0];
}

describe("durable workflow queue restoration", () => {
  let projectDir: string;
  let runState: RunStateDatabase;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-queue-restore-"));
    runState = new RunStateDatabase(join(projectDir, ".kota"));
    runState.registerProject({
      id: PROJECT_ID,
      rootPath: projectDir,
      createdAt: "2026-08-25T10:00:00.000Z",
    });
  });

  afterEach(() => {
    runState.close();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("revalidates durable queued runs without reordering durable admission", () => {
    const definition = workflow(projectDir);
    const admittedAt = "2026-08-25T10:00:00.000Z";
    const runs = [
      {
        id: "valid",
        workflow: definition.name,
        trigger: trigger("review.changed", { taskId: "valid", revision: 2 }),
        resources: ["task:valid"],
      },
      {
        id: "manual-control",
        workflow: definition.name,
        trigger: trigger("manual", { taskId: "manual" }),
        resources: ["task:manual"],
      },
      {
        id: "obsolete-event",
        workflow: definition.name,
        trigger: trigger("review.obsolete", { taskId: "obsolete", revision: 2 }),
        resources: ["task:obsolete"],
      },
      {
        id: "invalid-payload",
        workflow: definition.name,
        trigger: trigger("review.changed", { taskId: "invalid", revision: "bad" }),
        resources: ["task:invalid"],
      },
      {
        id: "rejected-admission",
        workflow: definition.name,
        trigger: trigger("review.changed", { taskId: "rejected", revision: 0 }),
        resources: ["task:rejected"],
      },
      {
        id: "changed-resource",
        workflow: definition.name,
        trigger: trigger("review.changed", { taskId: "changed", revision: 2 }),
        resources: ["task:old"],
      },
      {
        id: "missing-definition",
        workflow: "removed-workflow",
        trigger: trigger("review.changed", { taskId: "removed", revision: 2 }),
        resources: [],
      },
    ] as const;
    for (const run of runs) {
      runState.admitRun({
        ...run,
        projectId: PROJECT_ID,
        repository: definition.repository,
        admittedAt,
      });
    }

    const refill = vi.fn();
    const logs: string[] = [];
    const queue = new WorkflowQueueManager({
      store: new WorkflowRunStore(projectDir),
      runState,
      coordinator: { refill } as unknown as RunCoordinator,
      projectId: PROJECT_ID,
      projectDir,
      getScopeId: () => PROJECT_ID,
      getActiveBackoff: () => null,
      workflowUsesAgent: () => false,
      getDefinitions: () => [definition],
      log: (message) => logs.push(message),
    });

    queue.restorePending();

    expect(queue.getRuns().map((run) => run.runId)).toEqual([
      "valid",
      "manual-control",
    ]);
    expect(runState.listRuns(PROJECT_ID, ["cancelled"]).map((run) => run.id).sort()).toEqual([
      "changed-resource",
      "invalid-payload",
      "missing-definition",
      "obsolete-event",
      "rejected-admission",
    ]);
    expect(refill).toHaveBeenCalledOnce();
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.stringContaining("payload validation failed"),
        expect.stringContaining("revision was already consumed"),
        expect.stringContaining("resource ownership changed"),
        expect.stringContaining("Recovered 2 durable queued workflow run(s)"),
      ]),
    );
  });
});
