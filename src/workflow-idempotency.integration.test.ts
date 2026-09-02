import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installEventIdempotency } from "#core/daemon/idempotency-events.js";
import { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import { EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import { RunCoordinator } from "#core/workflow/run-coordinator.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { WorkflowRuntime, type WorkflowRuntimeConfig } from "#core/workflow/runtime.js";
import { type InboundSignalReceivedPayload, inboundSignalReceived } from "#modules/inbound-signals/events.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(10);
  }
  if (predicate()) return;
  throw new Error(message);
}

function makeScopeRoot(): string {
  const scopeRoot = join(
    tmpdir(),
    `kota-workflow-idempotency-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(scopeRoot, { recursive: true });
  return scopeRoot;
}

function inboundPayload(receivedAt: string): InboundSignalReceivedPayload {
  return {
    scopeId: "scope-a",
    provider: "telegram",
    channel: "message",
    accountId: "acct-1",
    sourceId: "chat-1",
    sourceUrl: "https://t.me/c/chat-1",
    externalId: "message-42",
    occurredAt: "2026-06-05T12:00:00.000Z",
    receivedAt,
    actor: {
      id: "user-1",
      displayName: "Trusted user",
      trust: "trusted",
      trustReason: "fixture",
    },
    body: {
      kind: "message",
      format: "plain",
      text: "book the 7pm slot",
    },
  };
}

describe("workflow idempotency integration", () => {
  const scopeRoots: string[] = [];
  const runtimes: WorkflowRuntime[] = [];
  const runStates: RunStateDatabase[] = [];

  function createRuntime(
    config: Omit<
      WorkflowRuntimeConfig,
      "scopeId" | "runState" | "runCoordinator" | "daemonEpoch"
    > & { scopeRoot: string },
  ): WorkflowRuntime {
    const runState = new RunStateDatabase(join(config.scopeRoot, ".kota", "state"));
    runStates.push(runState);
    const scopeId = "scope-a";
    runState.registerScope({
      id: scopeId,
      rootPath: config.scopeRoot,
      createdAt: "2026-08-25T10:00:00.000Z",
    });
    const daemonEpoch = runState.beginDaemonSession("2026-08-25T10:00:00.000Z").epoch;
    let runtime!: WorkflowRuntime;
    const runCoordinator = new RunCoordinator({
      store: runState,
      daemonEpoch,
      concurrency: 1,
      execute: (run, signal) => runtime.executeAdmittedRun(run, signal),
      deliverPublication: (publication) => runtime.deliverPublication(publication),
    });
    runtime = new WorkflowRuntime({
      ...config,
      scopeId,
      runState,
      runCoordinator,
      daemonEpoch,
    });
    return runtime;
  }

  afterEach(async () => {
    for (const runtime of runtimes.splice(0).reverse()) {
      await runtime.stop(0);
    }
    for (const runState of runStates.splice(0)) runState.close();
    for (const scopeRoot of scopeRoots.splice(0)) {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });

  it("dedupes repeated inbound signals before queueing duplicate workflow runs", async () => {
    const scopeRoot = makeScopeRoot();
    scopeRoots.push(scopeRoot);
    const bus = new EventBus();
    const pbus = new ScopedEventBus(bus, "scope-a");
    const idempotencyStore = new IdempotencyStore(
      join(scopeRoot, ".kota", "idempotency"),
      "scope-a",
    );
    installEventIdempotency(bus, {
      getDefaultScopeId: () => "scope-a",
      resolveStore: () => idempotencyStore,
    });

    const processed: string[] = [];
    const runtime = createRuntime({
      bus,
      pbus,
      scopeRoot,
      idempotencyStore,
      idleIntervalMs: 60_000,
      workflows: [
        {
          name: "inbound-signal-dedupe-fixture",
          definitionPath: "src/workflow-idempotency.integration.test.ts",
          moduleRoot: process.cwd(),
          enabled: true,
          repository: "none",
          tags: [],
          triggers: [{ event: inboundSignalReceived.name, cooldownMs: 0 }],
          steps: [
            {
              id: "record",
              type: "code",
              run: (ctx) => {
                processed.push(String(ctx.trigger.payload.externalId));
                return { externalId: ctx.trigger.payload.externalId };
              },
            },
          ],
        },
      ],
    });
    runtimes.push(runtime);
    runtime.start();

    pbus.emit(inboundSignalReceived, inboundPayload("2026-06-05T12:00:01.000Z"));
    pbus.emit(inboundSignalReceived, inboundPayload("2026-06-05T12:00:02.000Z"));

    await waitUntil(
      () => processed.length === 1 && runtime.getState().pendingRuns.length === 0,
      "workflow did not process exactly one inbound signal",
    );

    expect(processed).toEqual(["message-42"]);
    expect(idempotencyStore.list({ operation: "event-ingestion" })).toMatchObject([
      {
        scopeId: "scope-a",
        operation: "event-ingestion",
        status: "replayed",
        duplicateCount: 1,
      },
    ]);
  });

  it("redelivers a failed workflow intent emitted through the transactional outbox", async () => {
    const scopeRoot = makeScopeRoot();
    scopeRoots.push(scopeRoot);
    const bus = new EventBus();
    const pbus = new ScopedEventBus(bus, "scope-a");
    const idempotencyStore = new IdempotencyStore(
      join(scopeRoot, ".kota", "idempotency"),
      "scope-a",
    );
    installEventIdempotency(bus, {
      getDefaultScopeId: () => "scope-a",
      resolveStore: () => idempotencyStore,
    });

    let attempts = 0;
    const runtime = createRuntime({
      bus,
      pbus,
      scopeRoot,
      idempotencyStore,
      idleIntervalMs: 60_000,
      workflows: [
        {
          name: "semantic-intent-producer",
          definitionPath: "src/workflow-idempotency.integration.test.ts",
          moduleRoot: process.cwd(),
          enabled: true,
          repository: "none",
          tags: [],
          triggers: [{ event: "dispatch.requested", cooldownMs: 0, queueMode: "all" }],
          steps: [
            {
              id: "emit-task",
              type: "code",
              run: ({ emit }) => {
                emit(
                  "task.ready",
                  { idempotencyKey: "task:stable-contract" },
                  { delivery: "on-run-success", stepId: "emit-task" },
                );
                return { emitted: true };
              },
            },
          ],
        },
        {
          name: "semantic-intent-consumer",
          definitionPath: "src/workflow-idempotency.integration.test.ts",
          moduleRoot: process.cwd(),
          enabled: true,
          repository: "none",
          tags: [],
          triggers: [{ event: "task.ready", cooldownMs: 0, queueMode: "all" }],
          steps: [
            {
              id: "attempt",
              type: "code",
              run: () => {
                attempts += 1;
                if (attempts === 1) throw new Error("retryable failure");
                return { delivered: true };
              },
            },
          ],
        },
      ],
    });
    runtimes.push(runtime);
    runtime.start();

    bus.emit("dispatch.requested", { scopeId: "scope-a" }, "dispatch-1");
    await waitUntil(
      () => attempts === 1 && !runtime.isBusy(),
      "first semantic intent did not reach a terminal failure",
    );

    bus.emit("dispatch.requested", { scopeId: "scope-a" }, "dispatch-2");
    await waitUntil(
      () => attempts === 2 && !runtime.isBusy(),
      "failed semantic intent was not redelivered",
    );

    expect(attempts).toBe(2);
    expect(idempotencyStore.list({ operation: "event-ingestion" })).toEqual([]);
  });
});
