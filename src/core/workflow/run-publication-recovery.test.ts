import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import { RunCoordinator } from "./run-coordinator.js";
import { enqueueMatchingWorkflows } from "./run-executor-utils.js";
import { RunStateDatabase } from "./run-state-database.js";
import type { PendingRunPublication } from "./run-state-types.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowDefinition } from "./types.js";
import { WorkflowQueueManager } from "./workflow-queue.js";

const SCOPE_ID = "scope-a";
const PUBLISHER_RUN_ID = "publisher-run";
const PUBLICATION_ID = `workflow:${PUBLISHER_RUN_ID}:completed`;

function installDownstreamAdmission(
  scopeBus: ScopedEventBus,
  store: RunStateDatabase,
  coordinator: RunCoordinator,
  scopeRoot: string,
): void {
  const definition: WorkflowDefinition = {
    name: "downstream",
    enabled: true,
    moduleRoot: scopeRoot,
    repository: "none",
    tags: [],
    definitionPath: "src/core/workflow/run-publication-recovery.test.ts",
    triggers: [{ event: "workflow.completed", cooldownMs: 0, queueMode: "all" }],
    steps: [],
  };
  const queue = new WorkflowQueueManager({
    store: new WorkflowRunStore(scopeRoot),
    runState: store,
    coordinator,
    scopeId: SCOPE_ID,
    scopeRoot,
    getScopeId: () => SCOPE_ID,
    getActiveBackoff: () => null,
    workflowUsesAgent: () => false,
    getDefinitions: () => [definition],
    log: () => undefined,
  });
  scopeBus.onAny((envelope) => {
    enqueueMatchingWorkflows(envelope, [definition], (matched, trigger, run) =>
      queue.enqueue(matched, trigger, run),
    );
  });
}

function deliver(
  scopeBus: ScopedEventBus,
  publication: PendingRunPublication,
): void {
  if (publication.event !== "workflow.completed") {
    throw new Error(`Unexpected publication event "${publication.event}"`);
  }
  scopeBus.deliverOutbox(publication.event, publication.payload, publication.id);
}

function createCoordinator(
  store: RunStateDatabase,
  daemonEpoch: number,
  deliverPublication: (publication: PendingRunPublication) => void,
  publicationRetryMs = 1_000,
): RunCoordinator {
  const coordinator = new RunCoordinator({
    store,
    daemonEpoch,
    concurrency: 1,
    execute: async () => ({ kind: "terminal", state: "succeeded" }),
    deliverPublication,
    publicationRetryMs,
  });
  coordinator.pauseGlobalAdmission();
  return coordinator;
}

function persistPublication(
  store: RunStateDatabase,
  daemonEpoch: number,
): void {
  store.admitRun({
    id: PUBLISHER_RUN_ID,
    scopeId: SCOPE_ID,
    workflow: "publisher",
    repository: "none",
    trigger: { event: "manual", schemaRef: null, payload: {} },
    resources: [],
    admittedAt: "2026-08-25T10:00:01.000Z",
  });
  store.startRun(PUBLISHER_RUN_ID, daemonEpoch, "2026-08-25T10:00:02.000Z");
  store.finishRun(
    PUBLISHER_RUN_ID,
    daemonEpoch,
    "succeeded",
    "2026-08-25T10:00:03.000Z",
    undefined,
    {
      id: PUBLICATION_ID,
      runId: PUBLISHER_RUN_ID,
      scopeId: SCOPE_ID,
      event: "workflow.completed",
      payload: {
        workflow: "publisher",
        runId: PUBLISHER_RUN_ID,
        status: "success",
        triggerEvent: "manual",
        durationMs: 1_000,
        definitionPath: "test/publisher.ts",
        runDir: `.kota/runs/${PUBLISHER_RUN_ID}`,
        tags: [],
      },
    },
  );
}

describe("durable run publication recovery", () => {
  test("retries transient publication failures without another run or restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-run-publication-retry-"));
    let store: RunStateDatabase | undefined;

    try {
      store = new RunStateDatabase(join(root, "state"));
      store.registerScope({
        id: SCOPE_ID,
        rootPath: join(root, "project"),
        createdAt: "2026-08-25T10:00:00.000Z",
      });
      const session = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
      persistPublication(store, session.epoch);

      let attempts = 0;
      let acknowledgeRetry: (() => void) | undefined;
      const retried = new Promise<void>((resolve) => {
        acknowledgeRetry = resolve;
      });
      const coordinator = createCoordinator(
        store,
        session.epoch,
        () => {
          attempts += 1;
          if (attempts === 1) throw new Error("temporary delivery failure");
          acknowledgeRetry?.();
        },
        10,
      );

      await coordinator.drainPublications();
      expect(store.listPendingPublications()).toHaveLength(1);

      await retried;
      await coordinator.drainPublications();
      expect(attempts).toBe(2);
      expect(store.listPendingPublications()).toEqual([]);
    } finally {
      store?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("redelivery after synchronous admission and pre-ack crash admits downstream once", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-run-publication-recovery-"));
    const stateDir = join(root, "state");
    const scopeRoot = join(root, "project");
    let store: RunStateDatabase | undefined;
    let deliveries = 0;

    try {
      store = new RunStateDatabase(stateDir);
      store.registerScope({
        id: SCOPE_ID,
        rootPath: scopeRoot,
        createdAt: "2026-08-25T10:00:00.000Z",
      });
      const firstSession = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
      persistPublication(store, firstSession.epoch);

      const firstBus = new EventBus();
      const firstTarget = new ScopedEventBus(firstBus, SCOPE_ID);
      const firstCoordinator = createCoordinator(store, firstSession.epoch, (publication) => {
        deliveries += 1;
        deliver(firstTarget, publication);
      });
      installDownstreamAdmission(
        firstTarget,
        store,
        firstCoordinator,
        scopeRoot,
      );
      firstBus.addEmitMiddleware((_envelope, next) => {
        next();
        throw new Error("simulated process crash before publication acknowledgement");
      });

      await firstCoordinator.drainPublications();

      const firstAdmissions = store
        .listRuns(SCOPE_ID)
        .filter((run) => run.workflow === "downstream");
      expect(firstAdmissions).toHaveLength(1);
      expect(firstAdmissions[0]?.trigger.eventId).toBe(PUBLICATION_ID);
      expect(firstAdmissions[0]?.trigger.payload.publicationId).toBeUndefined();
      expect(store.listPendingPublications()).toHaveLength(1);

      const admittedRunId = firstAdmissions[0]!.id;
      store.close();
      store = undefined;
      store = new RunStateDatabase(stateDir);
      const reopenedSession = store.beginDaemonSession("2026-08-25T10:00:04.000Z");
      const reopenedBus = new EventBus();
      const reopenedTarget = new ScopedEventBus(reopenedBus, SCOPE_ID);
      const reopenedCoordinator = createCoordinator(
        store,
        reopenedSession.epoch,
        (publication) => {
          deliveries += 1;
          deliver(reopenedTarget, publication);
        },
      );
      installDownstreamAdmission(
        reopenedTarget,
        store,
        reopenedCoordinator,
        scopeRoot,
      );

      await reopenedCoordinator.drainPublications();

      expect(deliveries).toBe(2);
      expect(
        store.listRuns(SCOPE_ID)
          .filter((run) => run.workflow === "downstream")
          .map((run) => run.id),
      ).toEqual([admittedRunId]);
      expect(store.listPendingPublications()).toEqual([]);
    } finally {
      store?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
