import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunCoordinator } from "./run-coordinator.js";
import { RunStateDatabase } from "./run-state-database.js";
import { WorkflowRunStore } from "./run-store.js";
import {
  enqueuePendingRun,
  type WorkflowRuntimeRunsControlState,
} from "./runtime-runs-control.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition, WorkflowRecoveryDecision } from "./types.js";
import { registerWorkflowDefinition, validateWorkflowDefinitions } from "./validation.js";
import { workflowDispatchIdempotency } from "./workflow-idempotency.js";
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
  let coordinator: RunCoordinator;

  beforeEach(() => {
    scopeRoot = mkdtempSync(join(tmpdir(), "kota-queue-restore-"));
    runState = new RunStateDatabase(join(scopeRoot, ".kota"));
    runState.registerScope({
      id: SCOPE_ID,
      rootPath: scopeRoot,
      createdAt: "2026-08-25T10:00:00.000Z",
    });
    coordinator = new RunCoordinator({ store: runState, daemonEpoch: runState.getEpoch(),
      concurrency: 1, execute: async () => ({ kind: "terminal", state: "succeeded" }) });
    coordinator.pauseGlobalAdmission();
  });

  afterEach(async () => {
    await coordinator?.dispose();
    runState.close();
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it.each(["succeeded", "cancelled"] as const)("coalesces observations behind a yielded owner until it is %s", async (terminalState) => {
    const definition = validateWorkflowDefinitions([
      registerWorkflowDefinition("test/triage.ts", {
        name: "triage",
        repository: "read",
        resources: () => ["triage:whole-scope"],
        triggers: [{ event: "captures.available", cooldownMs: 30_000 }],
        steps: [{ id: "inspect", type: "code", run: () => null }],
      }),
    ], scopeRoot)[0];
    const queueForCurrentSession = () => new WorkflowQueueManager({
      store: new WorkflowRunStore(scopeRoot), runState, coordinator,
      scopeId: SCOPE_ID, scopeRoot, getScopeId: () => SCOPE_ID,
      getActiveBackoff: () => null, workflowUsesAgent: () => false,
      getDefinitions: () => [definition], log: () => {},
    });
    let queue = queueForCurrentSession();
    let observation = 0;
    const observe = (count: number) => queue.enqueue(definition, definition.triggers[0], {
      event: "captures.available", schemaRef: null,
      eventId: `observation-${++observation}`, payload: { count },
    });
    observe(1);
    const owner = queue.getRuns()[0].runId!;
    runState.startRun(owner, runState.getEpoch(), new Date().toISOString());
    observe(1);
    const successor = queue.getRuns()[0].runId!;
    runState.suspendRun({
      runId: owner, epoch: runState.getEpoch(), state: "waiting",
      suspendedAt: new Date().toISOString(),
      wait: { kind: "continuation", decision: "preserve-yield",
        decidedAt: new Date().toISOString(), blockerResources: ["task:urgent"] },
    });
    observe(1);
    await coordinator.dispose();
    runState.close();
    runState = new RunStateDatabase(join(scopeRoot, ".kota"));
    const { epoch } = runState.beginDaemonSession(new Date().toISOString());
    coordinator = new RunCoordinator({ store: runState, daemonEpoch: epoch,
      concurrency: 1, execute: async () => ({ kind: "terminal", state: "succeeded" }) });
    coordinator.pauseGlobalAdmission();
    queue = queueForCurrentSession();
    queue.restorePending();
    observe(2);
    observe(2);
    const afterCooldown = new Date(Date.now() + 60_000).toISOString();
    expect(runState.listDispatchableRuns({ now: afterCooldown, limit: 10, excludedScopeIds: [] })).toEqual([]);
    expect(runState.listRuns(SCOPE_ID)).toHaveLength(2);
    expect(runState.getRun(owner)).toMatchObject({ state: "waiting", attempt: 1, resources: ["triage:whole-scope"] });
    expect(queue.getRuns()).toMatchObject([{ runId: successor, trigger: { payload: { count: 2 } } }]);
    expect(runState.getRun(successor)).toMatchObject({ attempt: 0 });
    if (terminalState === "cancelled") {
      expect(coordinator.cancel(owner)).toEqual({ cancelled: true });
      await coordinator.whenIdle();
    } else {
      runState.resumeRun(owner, afterCooldown);
      runState.startRun(owner, epoch, afterCooldown);
      runState.finishRun(owner, epoch, terminalState, afterCooldown);
    }
    expect(runState.getRun(owner)).toMatchObject({ state: terminalState, resources: [] });
    expect(runState.listDispatchableRuns({ now: afterCooldown, limit: 10, excludedScopeIds: [] }).map((run) => run.id)).toEqual([successor]);
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
    async (_reason, contractChange) => {
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

      expect((await enqueuePendingRun(state, currentDefinition.name, {
        payload: { retryOf: runId },
      }))).toMatchObject({ ok: false, reason: "workflow_contract_conflict" });
      expect(runState.getRun(runId)?.state).toBe("queued");
      runState.requireRunAttention(runId, "preserved after runtime interruption", []);
      expect(
        (await enqueuePendingRun(state, currentDefinition.name, {
          payload: { retryOf: runId },
        })),
      ).toEqual({
        ok: false,
        error: `Retained run "${runId}" requires a relevant change and a compatible recovery contract; its sandbox and resources remain retained`,
        reason: "workflow_contract_conflict",
      });
      expect(runState.getRun(runId)?.state).toBe("needs_attention");
      expect(refill).not.toHaveBeenCalled();
    },
  );

  it.each(["trigger", "discovery"])("rejects competing admissions and resumes the retained %s resources", async (selection) => {
    const definition = workflow(scopeRoot);
    let discovered = ["task:held"];
    if (selection === "discovery") {
      definition.resources = ({ admittedResources }) => admittedResources ?? discovered;
    }
    const originalTrigger = trigger("review.changed", { taskId: "held", revision: 2, idempotencyKey: "held-contract" });
    runState.admitRun({
      id: "retained-owner",
      scopeId: SCOPE_ID,
      workflow: definition.name,
      trigger: originalTrigger,
      repository: definition.repository,
      resources: ["task:held"],
      admission: workflowDispatchIdempotency(SCOPE_ID, definition.name, originalTrigger)!,
      admittedAt: "2026-08-25T10:00:00.000Z",
    });
    runState.requireRunAttention("retained-owner", "requires evidence review", []);
    const logs: string[] = [];
    const queue = new WorkflowQueueManager({
      store: new WorkflowRunStore(scopeRoot),
      runState,
      coordinator,
      scopeId: SCOPE_ID,
      scopeRoot,
      getScopeId: () => SCOPE_ID,
      getActiveBackoff: () => null,
      workflowUsesAgent: () => false,
      getDefinitions: () => [definition],
      log: (message) => logs.push(message),
    });
    expect(queue.appendRun({
      runId: "duplicate-delivery",
      workflowName: definition.name,
      trigger: originalTrigger,
      enqueuedAtMs: Date.now(),
      notBeforeMs: Date.now(),
    })).toEqual({ status: "duplicate", runId: "retained-owner" });
    expect(queue.appendRun({
      runId: "competing-mutator",
      workflowName: definition.name,
      trigger: trigger("review.changed", { taskId: "held", revision: 3, idempotencyKey: "new-contract" }),
      enqueuedAtMs: Date.now(),
      notBeforeMs: Date.now(),
    })).toBeNull();
    expect(runState.getRun("competing-mutator")).toBeNull();
    expect(logs).toContainEqual(expect.stringContaining('retained run "retained-owner"'));
    // Discovery may change while an owner is suspended, including after its
    // own promotion is published but cleanup still needs recovery.
    discovered = ["task:newly-blocked"];
    expect((await queue.resumeRetainedRun("retained-owner", Date.now()))).toBe(true);
    expect(runState.getRun("retained-owner")).toMatchObject({
      state: "queued",
      trigger: originalTrigger,
      resources: ["task:held"],
    });
    expect(runState.listRuns(SCOPE_ID)).toHaveLength(1);
    queue.restorePending();
    expect(runState.getRun("retained-owner")?.state).toBe("queued");
  });

  it("reconciles a retained contract once, preserves its resource, and deduplicates the new dispatch", async () => {
    const original = trigger("review.changed", { taskId: "held", revision: 1, idempotencyKey: "old" });
    const revised = trigger("review.changed", { taskId: "held", revision: 2, idempotencyKey: "new" });
    const definition = workflow(scopeRoot);
    let finish!: (decision: WorkflowRecoveryDecision) => void;
    const recovery = vi.fn<NonNullable<WorkflowDefinition["recovery"]>>()
      .mockResolvedValueOnce({ resume: false, reason: "external prerequisite unchanged" })
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockReturnValue({ resume: true, trigger: revised, revision: "new-evidence" });
    definition.recovery = recovery;
    const queue = new WorkflowQueueManager({
      store: new WorkflowRunStore(scopeRoot), runState,
      coordinator,
      scopeId: SCOPE_ID, scopeRoot, getScopeId: () => SCOPE_ID,
      getActiveBackoff: () => null, workflowUsesAgent: () => false,
      getDefinitions: () => [definition], log: vi.fn(),
    });
    const queued = (runId: string, input: WorkflowRunTrigger) => ({
      runId, workflowName: definition.name, trigger: input,
      enqueuedAtMs: Date.now(), notBeforeMs: Date.now(),
    });
    queue.appendRun(queued("held-owner", original));
    runState.requireRunAttention("held-owner", "blocked", []);
    expect((await queue.resumeRetainedRun("held-owner", Date.now()))).toBe(false);
    expect(runState.getRun("held-owner")).toMatchObject({ state: "needs_attention", trigger: original });
    const first = queue.resumeRetainedRun("held-owner", Date.now());
    const duplicate = queue.resumeRetainedRun("held-owner", Date.now());
    expect(recovery).toHaveBeenCalledTimes(2);
    finish({ resume: true, trigger: revised, revision: "new-evidence" });
    expect(await first).toBe(true);
    expect(await duplicate).toBe(true);
    expect(runState.getRun("held-owner")).toMatchObject({ state: "queued", trigger: revised, resources: ["task:held"] });
    expect(queue.appendRun(queued("duplicate", revised))).toEqual({ status: "duplicate", runId: "held-owner" });
    runState.requireRunAttention("held-owner", "same failure", []);
    expect((await queue.resumeRetainedRun("held-owner", Date.now()))).toBe(false);
    expect(runState.listRuns(SCOPE_ID)).toHaveLength(1);
    expect(runState.readScopeStateValue(SCOPE_ID, "workflow:recovery:held-owner").value)
      .toMatchObject({ revision: "new-evidence", previousTrigger: original });
    const control = {
      definitions: [definition], runtimeConfig: { runState, scopeId: SCOPE_ID },
      wfQueue: queue, runCoordinator: coordinator,
    } as unknown as WorkflowRuntimeRunsControlState;
    const retry = { payload: { retryOf: "held-owner" } };
    expect(await enqueuePendingRun(control, definition.name, retry)).toMatchObject({ ok: false });
    expect(await enqueuePendingRun(control, definition.name, { ...retry, explicitRetry: true })).toMatchObject({ ok: true, runId: "held-owner" });
    expect(runState.getRun("held-owner")).toMatchObject({ state: "queued", trigger: revised, resources: ["task:held"] });
    expect(runState.listRuns(SCOPE_ID)).toHaveLength(1);
  });

  it("cannot resume a retained run changed while its asynchronous recovery is being assessed", async () => {
    const definition = workflow(scopeRoot);
    const original = trigger("review.changed", { taskId: "held", revision: 1 });
    let finish!: (decision: WorkflowRecoveryDecision) => void;
    definition.recovery = () => new Promise((resolve) => { finish = resolve; });
    const queue = new WorkflowQueueManager({
      store: new WorkflowRunStore(scopeRoot), runState,
      coordinator,
      scopeId: SCOPE_ID, scopeRoot, getScopeId: () => SCOPE_ID,
      getActiveBackoff: () => null, workflowUsesAgent: () => false,
      getDefinitions: () => [definition], log: vi.fn(),
    });
    queue.appendRun({ runId: "held-owner", workflowName: definition.name, trigger: original,
      enqueuedAtMs: Date.now(), notBeforeMs: Date.now() });
    runState.requireRunAttention("held-owner", "blocked", []);
    const pending = queue.resumeRetainedRun("held-owner", Date.now());
    runState.cancelQueuedRun("held-owner", new Date().toISOString());
    finish({ resume: true, trigger: original, revision: "new-evidence" });
    expect(await pending).toBe(false);
    expect(runState.getRun("held-owner")).toMatchObject({ state: "cancelled", trigger: original });
  });

  it.each(["manual", "resume", "workflow.triggered"] as const)(
    "revalidates the current payload schema before resuming a retained %s run",
    async (event) => {
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
        (await enqueuePendingRun(state, currentDefinition.name, {
          payload: { retryOf: runId },
        })),
      ).toEqual({
        ok: false,
        error: `Retained run "${runId}" requires a relevant change and a compatible recovery contract; its sandbox and resources remain retained`,
        reason: "workflow_contract_conflict",
      });
      expect(runState.getRun(runId)?.state).toBe("needs_attention");
      expect(refill).not.toHaveBeenCalled();
    },
  );
});
