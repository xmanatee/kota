import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunCoordinator } from "./run-coordinator.js";
import { RunStateDatabase } from "./run-state-database.js";
import { WorkflowRunStore } from "./run-store.js";
import {
  enqueuePendingRun,
  type WorkflowRuntimeRunsControlState,
} from "./runtime-runs-control.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";
import { registerWorkflowDefinition, validateWorkflowDefinitions } from "./validation.js";
import { WorkflowQueueManager } from "./workflow-queue.js";

const SCOPE_ID = "scope-queue-restoration";

function trigger(
  event: string,
  payload: Record<string, unknown>,
): WorkflowRunTrigger {
  return { event, schemaRef: null, payload };
}

type ContractChange =
  | "none"
  | "event"
  | "payload"
  | "admission"
  | "resources"
  | "repository";

function workflow(scopeRoot: string, contractChange: ContractChange = "none"): WorkflowDefinition {
  return validateWorkflowDefinitions(
    [
      registerWorkflowDefinition("test/workflow.ts", {
        name: "semantic-review",
        repository: contractChange === "repository" ? "none" : "read",
        triggers: [
          {
            event: contractChange === "event" ? "review.replaced" : "review.changed",
            queueMode: "all",
          },
        ],
        inputSchema: {
          type: "object",
          required: ["taskId", "revision"],
          properties: {
            taskId: { type: "string" },
            revision: { type: contractChange === "payload" ? "string" : "number" },
          },
        },
        resources: ({ trigger: runTrigger }) => [
          `task:${String(runTrigger.payload.taskId)}${contractChange === "resources" ? ":current" : ""}`,
        ],
        triggerAdmission: ({ trigger: runTrigger }) =>
          contractChange !== "admission" &&
          (runTrigger.event === "manual" || runTrigger.payload.revision !== 0)
            ? { admitted: true }
            : { admitted: false, reason: "revision was already consumed" },
        steps: [{ id: "noop", type: "code", run: () => ({ ok: true }) }],
      }),
    ],
    scopeRoot,
  )[0];
}

describe("durable workflow queue restoration", () => {
  let scopeRoot: string;
  let runState: RunStateDatabase;

  beforeEach(() => {
    scopeRoot = mkdtempSync(join(tmpdir(), "kota-queue-restore-"));
    runState = new RunStateDatabase(join(scopeRoot, ".kota"));
    runState.registerScope({
      id: SCOPE_ID,
      rootPath: scopeRoot,
      createdAt: "2026-08-25T10:00:00.000Z",
    });
  });

  afterEach(() => {
    runState.close();
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("revalidates durable queued runs without reordering durable admission", () => {
    const definition = workflow(scopeRoot);
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
        scopeId: SCOPE_ID,
        repository: definition.repository,
        admittedAt,
      });
    }

    const refill = vi.fn();
    const cancel = vi.fn((runId: string) => ({
      cancelled: runState.cancelQueuedRun(runId, "2026-08-25T10:00:02.000Z"),
    }));
    const logs: string[] = [];
    const queue = new WorkflowQueueManager({
      store: new WorkflowRunStore(scopeRoot),
      runState,
      coordinator: { cancel, refill } as unknown as RunCoordinator,
      scopeId: SCOPE_ID,
      scopeRoot,
      getScopeId: () => SCOPE_ID,
      getActiveBackoff: () => null,
      workflowUsesAgent: () => false,
      getDefinitions: () => [definition],
      log: (message) => logs.push(message),
    });

    queue.restorePending();

    expect(queue.getRuns().map((run) => run.runId)).toEqual(["valid"]);
    expect(runState.listRuns(SCOPE_ID, ["cancelled"]).map((run) => run.id).sort()).toEqual([
      "changed-resource",
      "invalid-payload",
      "manual-control",
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
        expect.stringContaining("Recovered 1 durable queued workflow run(s)"),
      ]),
    );
  });

  it.each([
    ["the event is no longer accepted", "event"],
    ["the payload no longer matches the schema", "payload"],
    ["current trigger admission rejects it", "admission"],
    ["resource ownership changed", "resources"],
    ["repository access changed", "repository"],
  ] as const)(
    "keeps a retained run in attention when %s",
    (_reason, contractChange) => {
      const admittedDefinition = workflow(scopeRoot);
      const runId = `retained-${contractChange}`;
      runState.admitRun({
        id: runId,
        scopeId: SCOPE_ID,
        workflow: admittedDefinition.name,
        trigger: trigger("review.changed", { taskId: contractChange, revision: 2 }),
        repository: admittedDefinition.repository,
        resources: [`task:${contractChange}`],
        admittedAt: "2026-08-25T10:00:00.000Z",
      });
      runState.requireRunAttention(runId, "preserved after runtime interruption", []);

      const currentDefinition = workflow(scopeRoot, contractChange);
      const refill = vi.fn();
      const queue = new WorkflowQueueManager({
        store: new WorkflowRunStore(scopeRoot),
        runState,
        coordinator: { refill } as unknown as RunCoordinator,
        scopeId: SCOPE_ID,
        scopeRoot,
        getScopeId: () => SCOPE_ID,
        getActiveBackoff: () => null,
        workflowUsesAgent: () => false,
        getDefinitions: () => [currentDefinition],
        log: vi.fn(),
      });
      const state = {
        definitions: [currentDefinition],
        runtimeConfig: { runState, scopeId: SCOPE_ID },
        wfQueue: queue,
      } as unknown as WorkflowRuntimeRunsControlState;

      expect(
        enqueuePendingRun(state, currentDefinition.name, {
          payload: { retryOf: runId },
        }),
      ).toEqual({
        ok: false,
        error: `Retained run "${runId}" no longer matches the loaded workflow contract`,
        reason: "workflow_contract_conflict",
      });
      expect(runState.getRun(runId)?.state).toBe("needs_attention");
      expect(refill).not.toHaveBeenCalled();
    },
  );

  it.each(["manual", "resume", "workflow.triggered"] as const)(
    "revalidates the current payload schema before resuming a retained %s run",
    (event) => {
      const admittedDefinition = workflow(scopeRoot);
      const runId = `retained-${event}`;
      runState.admitRun({
        id: runId,
        scopeId: SCOPE_ID,
        workflow: admittedDefinition.name,
        trigger: trigger(event, { taskId: event, revision: 2 }),
        repository: admittedDefinition.repository,
        resources: [`task:${event}`],
        admittedAt: "2026-08-25T10:00:00.000Z",
      });
      runState.requireRunAttention(runId, "preserved after runtime interruption", []);

      const currentDefinition = workflow(scopeRoot, "payload");
      const refill = vi.fn();
      const queue = new WorkflowQueueManager({
        store: new WorkflowRunStore(scopeRoot),
        runState,
        coordinator: { refill } as unknown as RunCoordinator,
        scopeId: SCOPE_ID,
        scopeRoot,
        getScopeId: () => SCOPE_ID,
        getActiveBackoff: () => null,
        workflowUsesAgent: () => false,
        getDefinitions: () => [currentDefinition],
        log: vi.fn(),
      });
      const state = {
        definitions: [currentDefinition],
        runtimeConfig: { runState, scopeId: SCOPE_ID },
        wfQueue: queue,
      } as unknown as WorkflowRuntimeRunsControlState;

      expect(
        enqueuePendingRun(state, currentDefinition.name, {
          payload: { retryOf: runId },
        }),
      ).toEqual({
        ok: false,
        error: `Retained run "${runId}" no longer matches the loaded workflow contract`,
        reason: "workflow_contract_conflict",
      });
      expect(runState.getRun(runId)?.state).toBe("needs_attention");
      expect(refill).not.toHaveBeenCalled();
    },
  );
});
