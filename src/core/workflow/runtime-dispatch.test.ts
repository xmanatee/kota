import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { RunCoordinator } from "./run-coordinator.js";
import { RunStateDatabase } from "./run-state-database.js";
import { WorkflowRuntime, type WorkflowRuntimeConfig } from "./runtime.js";
import type { RegisteredWorkflowDefinitionInput } from "./types.js";

const runStates: RunStateDatabase[] = [];

function createRuntime(
  config: Omit<
    WorkflowRuntimeConfig,
    "scopeId" | "runState" | "runCoordinator" | "daemonEpoch"
  > & { scopeRoot: string },
  concurrency = 2,
): WorkflowRuntime {
  const runState = new RunStateDatabase(join(config.scopeRoot, ".kota", "state"));
  runStates.push(runState);
  const scopeId = "test-scope";
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
    concurrency,
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  predicate: () => boolean,
  message: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(10);
  }
  if (predicate()) return;
  throw new Error(message);
}

function makeScopeRoot(): string {
  const workspaceRoot = join(
    tmpdir(),
    `kota-idle-dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(join(workspaceRoot, ".gitignore"), ".kota/\n");
  execFileSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });
  execFileSync("git", ["add", ".gitignore"], { cwd: workspaceRoot, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-m", "init"],
    { cwd: workspaceRoot, stdio: "ignore" },
  );
  return workspaceRoot;
}

const idleWorkflow: RegisteredWorkflowDefinitionInput = {
  repository: "read",
  name: "idle-listener",
  definitionPath: "src/core/workflow/runtime-dispatch.test.ts",
  moduleRoot: process.cwd(),
  triggers: [{ event: "runtime.idle", cooldownMs: 0 }],
  steps: [
    {
      id: "noop",
      type: "code",
      run: () => ({ ok: true }),
    },
  ],
};

function countIdleRuns(workspaceRoot: string): number {
  return countWorkflowRuns(workspaceRoot, "idle-listener");
}

function countWorkflowRuns(workspaceRoot: string, workflowName: string): number {
  const runsDir = join(workspaceRoot, ".kota", "runs");
  if (!existsSync(runsDir)) return 0;
  return readdirSync(runsDir).filter((runId) => {
    const metadataPath = join(runsDir, runId, "metadata.json");
    if (!existsSync(metadataPath)) return false;
    return runId.includes(workflowName);
  }).length;
}

describe("runtime idle dispatch", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = makeScopeRoot();
  });

  afterEach(() => {
    for (const runState of runStates.splice(0)) runState.close();
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("does not keep dispatching runtime.idle while repo state is unchanged", async () => {
    const runtime = createRuntime({
      bus: new EventBus(),
      scopeRoot: workspaceRoot,
      idleIntervalMs: 10,
      workflows: [idleWorkflow],
    });

    runtime.start();
    await wait(120);
    await runtime.stop();

    expect(countIdleRuns(workspaceRoot)).toBe(1);
  });

  it("dispatches runtime.idle again after the repo state changes", async () => {
    const runtime = createRuntime({
      bus: new EventBus(),
      scopeRoot: workspaceRoot,
      idleIntervalMs: 10,
      workflows: [idleWorkflow],
    });

    runtime.start();
    await wait(50);
    mkdirSync(join(workspaceRoot, "data", "inbox"), { recursive: true });
    writeFileSync(join(workspaceRoot, "data", "inbox", "idea.md"), "New work\n");
    await wait(80);
    await runtime.stop();

    expect(countIdleRuns(workspaceRoot)).toBe(2);
  });

  it("dispatches manually enqueued workflow runs immediately", async () => {
    const runtime = createRuntime({
      bus: new EventBus(),
      scopeRoot: workspaceRoot,
      idleIntervalMs: 60_000,
      workflows: [
        {
          repository: "read",
          name: "manual-listener",
          definitionPath: "src/core/workflow/runtime-dispatch.test.ts",
          moduleRoot: process.cwd(),
          triggers: [{ event: "manual", cooldownMs: 0 }],
          steps: [
            {
              id: "noop",
              type: "code",
              run: () => ({ ok: true }),
            },
          ],
        },
      ],
    });

    runtime.start();
    const result = runtime.enqueuePendingRun("manual-listener");
    await wait(120);
    await runtime.stop();

    expect(result.ok).toBe(true);
    expect(countWorkflowRuns(workspaceRoot, "manual-listener")).toBe(1);
    expect(runtime.getState().pendingRuns).toHaveLength(0);
  });

  it("dispatches webhook-enqueued workflow runs immediately", async () => {
    const runtime = createRuntime({
      bus: new EventBus(),
      scopeRoot: workspaceRoot,
      idleIntervalMs: 60_000,
      workflows: [
        {
          repository: "read",
          name: "webhook-listener",
          definitionPath: "src/core/workflow/runtime-dispatch.test.ts",
          moduleRoot: process.cwd(),
          triggers: [{ webhook: true }],
          steps: [
            {
              id: "noop",
              type: "code",
              run: () => ({ ok: true }),
            },
          ],
        },
      ],
    });

    runtime.start();
    const result = runtime.enqueueWebhookRun("webhook-listener", {
      body: { ok: true },
      headers: {},
      timestamp: new Date().toISOString(),
      idempotencyKey: "webhook-body:dispatch-test",
    });
    await wait(120);
    await runtime.stop();

    expect(result.ok).toBe(true);
    expect(countWorkflowRuns(workspaceRoot, "webhook-listener")).toBe(1);
    expect(runtime.getState().pendingRuns).toHaveLength(0);
  });

  it("dedupes repeated webhook deliveries before appending duplicate queued runs", async () => {
    const runtime = createRuntime({
      bus: new EventBus(),
      scopeRoot: workspaceRoot,
      idleIntervalMs: 60_000,
      workflows: [
        {
          repository: "read",
          name: "webhook-listener",
          definitionPath: "src/core/workflow/runtime-dispatch.test.ts",
          moduleRoot: process.cwd(),
          triggers: [{ webhook: true }],
          steps: [
            {
              id: "noop",
              type: "code",
              run: () => ({ ok: true }),
            },
          ],
        },
      ],
    });

    runtime.start();
    runtime.setDispatchPaused(true);
    const first = runtime.enqueueWebhookRun("webhook-listener", {
      body: { ok: true },
      headers: { "content-type": "application/json" },
      timestamp: "2026-06-05T12:00:00.000Z",
      idempotencyKey: "webhook-body:duplicate-delivery",
    });
    const duplicate = runtime.enqueueWebhookRun("webhook-listener", {
      body: { ok: true },
      headers: { "content-type": "application/json" },
      timestamp: "2026-06-05T12:00:01.000Z",
      idempotencyKey: "webhook-body:duplicate-delivery",
    });
    await runtime.stop();

    expect(first.ok).toBe(true);
    expect(duplicate).toMatchObject({ ok: true, runId: first.runId });
    expect(runtime.getState().pendingRuns).toHaveLength(1);
  });

  it("keeps explicitly keyed deliveries as separate queued runs", async () => {
    const runtime = createRuntime({
      bus: new EventBus(),
      scopeRoot: workspaceRoot,
      idleIntervalMs: 60_000,
      workflows: [
        {
          repository: "read",
          name: "webhook-listener",
          definitionPath: "src/core/workflow/runtime-dispatch.test.ts",
          moduleRoot: process.cwd(),
          triggers: [{ webhook: true }],
          steps: [
            {
              id: "noop",
              type: "code",
              run: () => ({ ok: true }),
            },
          ],
        },
      ],
    });

    runtime.start();
    runtime.setDispatchPaused(true);
    runtime.enqueueWebhookRun("webhook-listener", {
      body: { taskId: "task-one" },
      headers: {},
      timestamp: "2026-06-05T12:00:00.000Z",
      idempotencyKey: "task-one",
    });
    runtime.enqueueWebhookRun("webhook-listener", {
      body: { taskId: "task-two" },
      headers: {},
      timestamp: "2026-06-05T12:00:01.000Z",
      idempotencyKey: "task-two",
    });
    await runtime.stop();

    expect(runtime.getState().pendingRuns).toHaveLength(2);
    expect(
      runtime.getState().pendingRuns.map((run) => run.trigger.payload.idempotencyKey),
    ).toEqual(["task-one", "task-two"]);
  });

  it("keeps every payload for lossless event triggers while dispatch is busy", async () => {
    const bus = new EventBus();
    let eventSequence = 0;
    bus.addEmitMiddleware((envelope, next) => {
      if (envelope.type === "work.completed") {
        eventSequence += 1;
        envelope.eventId = `evtj-${eventSequence}`;
      }
      next();
    });
    const runtime = createRuntime({
      bus,
      scopeRoot: workspaceRoot,
      idleIntervalMs: 60_000,
      workflows: [
        {
          repository: "read",
          name: "lossless-listener",
          definitionPath: "src/core/workflow/runtime-dispatch.test.ts",
          moduleRoot: process.cwd(),
          triggers: [{ event: "work.completed", queueMode: "all" }],
          steps: [{ id: "noop", type: "code", run: () => ({ ok: true }) }],
        },
      ],
    });

    runtime.start();
    runtime.setDispatchPaused(true);
    bus.emit("work.completed", { runId: "run-a" });
    bus.emit("work.completed", { runId: "run-b" });
    await runtime.stop();

    const pending = runtime.getState().pendingRuns;
    expect(pending.map((run) => run.trigger.payload.runId).sort()).toEqual([
      "run-a",
      "run-b",
    ]);
    expect(new Set(pending.map((run) => run.runId)).size).toBe(2);
  });

  it("keeps one stable slot with the newest payload for latest event triggers", async () => {
    const bus = new EventBus();
    let eventSequence = 0;
    bus.addEmitMiddleware((envelope, next) => {
      if (envelope.type === "work.changed") {
        eventSequence += 1;
        envelope.eventId = `evtj-${eventSequence}`;
      }
      next();
    });
    const runtime = createRuntime({
      bus,
      scopeRoot: workspaceRoot,
      idleIntervalMs: 60_000,
      workflows: [
        {
          repository: "read",
          name: "latest-listener",
          definitionPath: "src/core/workflow/runtime-dispatch.test.ts",
          moduleRoot: process.cwd(),
          triggers: [{ event: "work.changed" }],
          steps: [{ id: "noop", type: "code", run: () => ({ ok: true }) }],
        },
      ],
    });

    runtime.start();
    runtime.setDispatchPaused(true);
    bus.emit("work.changed", { version: 1 });
    const firstRunId = runtime.getState().pendingRuns[0]?.runId;
    bus.emit("work.changed", { version: 2 });
    await runtime.stop();

    expect(runtime.getState().pendingRuns).toMatchObject([
      {
        runId: firstRunId,
        trigger: { payload: { version: 2 } },
      },
    ]);
  });

  it("dedupes replayed durable event-triggered workflow dispatches", async () => {
    const bus = new EventBus();
    bus.addEmitMiddleware((envelope, next) => {
      if (envelope.type === "custom.event") envelope.eventId = "evtj-000000000123";
      next();
    });
    const processed: string[] = [];
    const runtime = createRuntime({
      bus,
      scopeRoot: workspaceRoot,
      idleIntervalMs: 60_000,
      workflows: [
        {
          repository: "read",
          name: "custom-event-listener",
          definitionPath: "src/core/workflow/runtime-dispatch.test.ts",
          moduleRoot: process.cwd(),
          triggers: [{ event: "custom.event", cooldownMs: 0 }],
          steps: [
            {
              id: "record",
              type: "code",
              run: (ctx) => {
                processed.push(String(ctx.trigger.payload.status));
                return { ok: true };
              },
            },
          ],
        },
      ],
    });

    runtime.start();
    bus.emit("custom.event", { status: "ready" });
    await waitUntil(
      () =>
        processed.length === 1 &&
        !runtime.isBusy() &&
        runtime.getState().pendingRuns.length === 0,
      "Timed out waiting for first custom event workflow run",
    );

    bus.emit("custom.event", { status: "ready" });
    await wait(120);
    await runtime.stop();

    expect(processed).toEqual(["ready"]);
    expect(countWorkflowRuns(workspaceRoot, "custom-event-listener")).toBe(1);
  });

  it("dispatches workflows emitted while coordinator capacity is occupied", async () => {
    const runtime = createRuntime({
      bus: new EventBus(),
      scopeRoot: workspaceRoot,
      idleIntervalMs: 60_000,
      workflows: [
        {
          repository: "read",
          name: "dispatcher",
          definitionPath: "src/core/workflow/runtime-dispatch.test.ts",
          moduleRoot: process.cwd(),
          triggers: [{ event: "runtime.idle", cooldownMs: 0 }],
          steps: [
            {
              id: "emit-events",
              type: "code",
              run: ({ emit }) => {
                emit("autonomy.queue.available", {
                  taskId: "task-runtime-dispatch",
                  taskPath: "data/tasks/task-runtime-dispatch.md",
                  taskState: "open",
                  taskDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  title: "Runtime dispatch fixture",
                  priority: "p2",
                  dependsOn: [],
                  idempotencyKey: "builder:task-runtime-dispatch:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                });
                emit("autonomy.security-review.due", {
                  due: true,
                  reason: "high-risk-security-sensitive-change",
                });
                return { emitted: true };
              },
            },
          ],
        },
        {
          repository: "read",
          name: "builder-like-agent-slot",
          definitionPath: "src/core/workflow/runtime-dispatch.test.ts",
          moduleRoot: process.cwd(),
          triggers: [{ event: "autonomy.queue.available", cooldownMs: 0 }],
          steps: [
            {
              id: "hold-agent-slot",
              type: "code",
              run: async () => {
                await wait(80);
                return { ok: true };
              },
            },
          ],
        },
        {
          repository: "read",
          name: "security-review",
          definitionPath: "src/core/workflow/runtime-dispatch.test.ts",
          moduleRoot: process.cwd(),
          triggers: [{ event: "autonomy.security-review.due", cooldownMs: 0 }],
          steps: [
            {
              id: "record-review",
              type: "code",
              run: () => ({ ok: true }),
            },
          ],
        },
      ],
    }, 1);

    runtime.start();
    try {
      await waitUntil(
        () =>
          countWorkflowRuns(workspaceRoot, "builder-like-agent-slot") === 1 &&
          countWorkflowRuns(workspaceRoot, "security-review") === 1 &&
          runtime.getState().pendingRuns.length === 0,
        "Timed out waiting for emitted workflows to dispatch",
      );
    } finally {
      await runtime.stop();
    }

    expect(countWorkflowRuns(workspaceRoot, "builder-like-agent-slot")).toBe(1);
    expect(countWorkflowRuns(workspaceRoot, "security-review")).toBe(1);
    expect(runtime.getState().pendingRuns).toHaveLength(0);
  });

});
