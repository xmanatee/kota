import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import {
  initModuleEventRegistry,
  resetModuleEventRegistry,
} from "#core/events/module-event.js";
import { defineProjectScopedModuleEvent, ProjectScopedEventBus } from "#core/events/project-scope.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowStepContext } from "./run-types.js";
import { WorkflowRuntime } from "./runtime.js";
import {
  WORKFLOW_BATCH_FLUSH_EVENT,
  type WorkflowBatchFlushPayload,
} from "./trigger-types.js";
import {
  registerWorkflowDefinition,
  validateWorkflowDefinitions,
} from "./validation.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeProjectDir(): string {
  const projectDir = join(
    tmpdir(),
    `kota-event-batches-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(projectDir, { recursive: true });
  return projectDir;
}

function readRunPayloads(projectDir: string): WorkflowBatchFlushPayload[] {
  const runsDir = join(projectDir, ".kota", "runs");
  return readdirSync(runsDir).map((runId) => {
    const trigger = JSON.parse(
      readFileSync(join(runsDir, runId, "trigger.json"), "utf-8"),
    );
    return trigger.payload as WorkflowBatchFlushPayload;
  });
}

describe("WorkflowEventBatchManager", () => {
  const runtimes: WorkflowRuntime[] = [];
  const projectDirs: string[] = [];

  afterEach(async () => {
    for (const runtime of runtimes.splice(0).reverse()) {
      await runtime.stop(0);
    }
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
    resetModuleEventRegistry();
  });

  function trackProjectDir(projectDir = makeProjectDir()): string {
    projectDirs.push(projectDir);
    return projectDir;
  }

  function startRuntime(
    projectDir: string,
    bus: EventBus,
    workflows: Parameters<typeof registerWorkflowDefinition>[1][],
    pbus?: ProjectScopedEventBus,
  ): WorkflowRuntime {
    const runtime = new WorkflowRuntime({
      bus,
      pbus,
      projectDir,
      idleIntervalMs: 10_000,
      workflows: workflows.map((workflow, index) =>
        registerWorkflowDefinition(`test/batch-${index}.ts`, workflow),
      ),
    });
    runtimes.push(runtime);
    runtime.start();
    return runtime;
  }

  it("flushes by count and runs the downstream workflow with input envelopes", async () => {
    const projectDir = trackProjectDir();
    const bus = new EventBus();
    const processed: WorkflowBatchFlushPayload[] = [];
    const emitted: WorkflowBatchFlushPayload[] = [];
    let eventId = 0;
    bus.addEmitMiddleware((envelope, next) => {
      if (envelope.type === "telegram.message") {
        eventId += 1;
        envelope.eventId = `evtj-${eventId}`;
      }
      next();
    });
    bus.on(WORKFLOW_BATCH_FLUSH_EVENT, (payload) => {
      emitted.push(payload as WorkflowBatchFlushPayload);
    });

    startRuntime(projectDir, bus, [
      {
        name: "telegram-batch",
        triggers: [
          {
            event: "telegram.message",
            filter: { kind: "message" },
            batch: {
              maxCount: 3,
              maxAgeMs: 60_000,
              groupBy: "chatId",
              maxBufferSize: 5,
              overflow: "flush-oldest",
            },
          },
        ],
        steps: [
          {
            id: "process",
            type: "code",
            run: (ctx) => {
              processed.push(ctx.trigger.payload as WorkflowBatchFlushPayload);
              return { staged: true };
            },
          },
        ],
      },
    ]);

    bus.emit("telegram.message", { kind: "message", chatId: "sports", text: "one" });
    bus.emit("telegram.message", { kind: "message", chatId: "sports", text: "two" });
    bus.emit("telegram.message", { kind: "message", chatId: "sports", text: "three" });
    await wait(80);

    expect(processed).toHaveLength(1);
    expect(processed[0]).toMatchObject({
      sourceEventName: "telegram.message",
      groupingKey: "chatId=sports",
      reason: "count",
      count: 3,
      batch: {
        workflow: "telegram-batch",
        triggerIndex: 0,
        maxBufferSize: 5,
        overflow: "flush-oldest",
        droppedInputCount: 0,
      },
    });
    expect(processed[0]!.inputEvents.map((entry) => entry.payload.text)).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(processed[0]!.inputEvents.map((entry) => entry.eventId)).toEqual([
      "evtj-1",
      "evtj-2",
      "evtj-3",
    ]);
    expect(emitted).toHaveLength(1);
    expect(readRunPayloads(projectDir)[0]).toMatchObject({
      reason: "count",
      count: 3,
      groupingKey: "chatId=sports",
    });
  });

  it("groups batch buffers by dotted payload paths", async () => {
    const projectDir = trackProjectDir();
    const bus = new EventBus();
    const processed: WorkflowBatchFlushPayload[] = [];

    startRuntime(projectDir, bus, [
      {
        name: "nested-group-batch",
        triggers: [
          {
            event: "inbound.signal",
            batch: {
              maxCount: 2,
              groupBy: "actor.trust",
              maxBufferSize: 4,
              overflow: "flush-oldest",
            },
          },
        ],
        steps: [
          {
            id: "process",
            type: "code",
            run: (ctx) => {
              processed.push(ctx.trigger.payload as WorkflowBatchFlushPayload);
            },
          },
        ],
      },
    ]);

    bus.emit("inbound.signal", { actor: { trust: "trusted" }, id: "one" });
    bus.emit("inbound.signal", { actor: { trust: "blocked" }, id: "two" });
    bus.emit("inbound.signal", { actor: { trust: "trusted" }, id: "three" });
    await wait(80);

    expect(processed).toHaveLength(1);
    expect(processed[0]?.groupingKey).toBe("actor.trust=trusted");
    expect(processed[0]?.inputEvents.map((entry) => entry.payload.id)).toEqual([
      "one",
      "three",
    ]);
  });

  it("validates strict batch payload schemas without internal run metadata", async () => {
    const projectDir = trackProjectDir();
    const bus = new EventBus();
    const processed: WorkflowBatchFlushPayload[] = [];

    startRuntime(projectDir, bus, [
      {
        name: "strict-batch",
        inputSchema: {
          type: "object",
          required: [
            "scopeId",
            "projectId",
            "sourceEventName",
            "groupingKey",
            "reason",
            "count",
            "window",
            "inputEvents",
            "batch",
          ],
          properties: {
            scopeId: { type: "string" },
            projectId: { type: "string" },
            sourceEventName: { type: "string" },
            groupingKey: { type: "string" },
            reason: { type: "string" },
            count: { type: "number" },
            window: { type: "object" },
            inputEvents: { type: "array" },
            batch: { type: "object" },
          },
          additionalProperties: false,
        },
        triggers: [
          {
            event: "telegram.message",
            batch: {
              maxCount: 2,
              groupBy: "chatId",
              maxBufferSize: 2,
              overflow: "flush-oldest",
            },
          },
        ],
        steps: [
          {
            id: "process",
            type: "code",
            run: (ctx) => {
              processed.push(ctx.trigger.payload as WorkflowBatchFlushPayload);
            },
          },
        ],
      },
    ]);

    bus.emit("telegram.message", { chatId: "strict", text: "one" });
    bus.emit("telegram.message", { chatId: "strict", text: "two" });
    await wait(80);

    expect(processed).toHaveLength(1);
    expect(processed[0]).not.toHaveProperty("_runId");
    expect(readRunPayloads(projectDir)[0]).not.toHaveProperty("_runId");
  });

  it("flushes by max age and idle timeout", async () => {
    const projectDir = trackProjectDir();
    const bus = new EventBus();
    const processed: WorkflowBatchFlushPayload[] = [];

    startRuntime(projectDir, bus, [
      {
        name: "age-batch",
        triggers: [
          {
            event: "task.changed",
            batch: {
              maxAgeMs: 20,
              groupBy: "bucket",
              maxBufferSize: 5,
              overflow: "flush-oldest",
            },
          },
        ],
        steps: [
          {
            id: "process-age",
            type: "code",
            run: (ctx) => {
              processed.push(ctx.trigger.payload as WorkflowBatchFlushPayload);
            },
          },
        ],
      },
      {
        name: "idle-batch",
        triggers: [
          {
            event: "task.changed",
            filter: { bucket: "idle" },
            batch: {
              idleTimeoutMs: 20,
              groupBy: "bucket",
              maxBufferSize: 5,
              overflow: "flush-oldest",
            },
          },
        ],
        steps: [
          {
            id: "process-idle",
            type: "code",
            run: (ctx) => {
              processed.push(ctx.trigger.payload as WorkflowBatchFlushPayload);
            },
          },
        ],
      },
    ]);

    bus.emit("task.changed", { bucket: "age", id: "a" });
    bus.emit("task.changed", { bucket: "idle", id: "i" });
    await wait(90);

    expect(processed.map((payload) => payload.reason).sort()).toEqual([
      "idle-timeout",
      "max-age",
      "max-age",
    ]);
  });

  it("recovers persisted buffers after runtime restart", async () => {
    const projectDir = trackProjectDir();
    const bus = new EventBus();
    const processed: WorkflowBatchFlushPayload[] = [];
    const workflow = {
      name: "restart-batch",
      triggers: [
        {
          event: "task.changed",
          batch: {
            maxCount: 2,
            maxAgeMs: 60_000,
            groupBy: "list",
            maxBufferSize: 4,
            overflow: "flush-oldest" as const,
          },
        },
      ],
      steps: [
        {
          id: "process",
          type: "code" as const,
          run: (ctx: WorkflowStepContext) => {
            processed.push(ctx.trigger.payload as WorkflowBatchFlushPayload);
          },
        },
      ],
    };

    const firstRuntime = startRuntime(projectDir, bus, [workflow]);
    bus.emit("task.changed", { list: "ready", id: "first" });
    await wait(30);
    expect(
      Object.keys(new WorkflowRunStore(projectDir).getBatchBuffers()).some((key) =>
        key.includes("restart-batch"),
      ),
    ).toBe(true);
    await firstRuntime.stop(0);
    runtimes.splice(runtimes.indexOf(firstRuntime), 1);

    startRuntime(projectDir, bus, [workflow]);
    bus.emit("task.changed", { list: "ready", id: "second" });
    await wait(80);

    expect(processed).toHaveLength(1);
    expect(processed[0]!.reason).toBe("count");
    expect(processed[0]!.inputEvents.map((entry) => entry.payload.id)).toEqual([
      "first",
      "second",
    ]);
  });

  it("isolates buffers by scope and supports explicit manual flush", async () => {
    const bus = new EventBus();
    const projectA = trackProjectDir();
    const projectB = trackProjectDir();
    const processedA: WorkflowBatchFlushPayload[] = [];
    const processedB: WorkflowBatchFlushPayload[] = [];
    const workflowA = {
      name: "scoped-batch",
      triggers: [
        {
          event: "task.changed",
          batch: {
            maxCount: 2,
            maxAgeMs: 60_000,
            flushEvent: "workflow.batch.flush",
            groupBy: "bucket",
            maxBufferSize: 4,
            overflow: "flush-oldest" as const,
          },
        },
      ],
      steps: [
        {
          id: "process",
          type: "code" as const,
          run: (ctx: WorkflowStepContext) => {
            processedA.push(ctx.trigger.payload as WorkflowBatchFlushPayload);
          },
        },
      ],
    };
    const workflowB = {
      ...workflowA,
      steps: [
        {
          id: "process",
          type: "code" as const,
          run: (ctx: WorkflowStepContext) => {
            processedB.push(ctx.trigger.payload as WorkflowBatchFlushPayload);
          },
        },
      ],
    };

    startRuntime(projectA, bus, [workflowA], new ProjectScopedEventBus(bus, "scope-a"));
    startRuntime(projectB, bus, [workflowB], new ProjectScopedEventBus(bus, "scope-b"));

    bus.emit("task.changed", { projectId: "scope-a", bucket: "daily", id: "a1" });
    bus.emit("task.changed", { projectId: "scope-b", bucket: "daily", id: "b1" });
    bus.emit("task.changed", { projectId: "scope-a", bucket: "daily", id: "a2" });
    await wait(80);

    expect(processedA).toHaveLength(1);
    expect(processedA[0]).toMatchObject({ scopeId: "scope-a", reason: "count", count: 2 });
    expect(processedB).toHaveLength(0);

    bus.emit("workflow.batch.flush", {
      projectId: "scope-b",
      workflow: "scoped-batch",
      sourceEventName: "task.changed",
    });
    await wait(80);

    expect(processedB).toHaveLength(1);
    expect(processedB[0]).toMatchObject({ scopeId: "scope-b", reason: "manual", count: 1 });
  });

  it("records overflow handling in the flushed payload", async () => {
    const projectDir = trackProjectDir();
    const bus = new EventBus();
    const processed: WorkflowBatchFlushPayload[] = [];

    startRuntime(projectDir, bus, [
      {
        name: "overflow-batch",
        triggers: [
          {
            event: "task.changed",
            batch: {
              idleTimeoutMs: 20,
              groupBy: "bucket",
              maxBufferSize: 2,
              overflow: "drop-newest",
            },
          },
        ],
        steps: [
          {
            id: "process",
            type: "code",
            run: (ctx) => {
              processed.push(ctx.trigger.payload as WorkflowBatchFlushPayload);
            },
          },
        ],
      },
    ]);

    bus.emit("task.changed", { bucket: "overflow", id: "first" });
    bus.emit("task.changed", { bucket: "overflow", id: "second" });
    bus.emit("task.changed", { bucket: "overflow", id: "dropped" });
    await wait(90);

    expect(processed).toHaveLength(1);
    expect(processed[0]).toMatchObject({
      reason: "idle-timeout",
      count: 2,
      batch: { overflow: "drop-newest", droppedInputCount: 1 },
    });
    expect(processed[0]!.inputEvents.map((entry) => entry.payload.id)).toEqual([
      "first",
      "second",
    ]);
  });

  it("flushes the oldest buffer and schedules the replacement on overflow", async () => {
    const projectDir = trackProjectDir();
    const bus = new EventBus();
    const processed: WorkflowBatchFlushPayload[] = [];

    startRuntime(projectDir, bus, [
      {
        name: "flush-oldest-overflow-batch",
        triggers: [
          {
            event: "task.changed",
            batch: {
              idleTimeoutMs: 20,
              groupBy: "bucket",
              maxBufferSize: 2,
              overflow: "flush-oldest",
            },
          },
        ],
        steps: [
          {
            id: "process",
            type: "code",
            run: (ctx) => {
              processed.push(ctx.trigger.payload as WorkflowBatchFlushPayload);
            },
          },
        ],
      },
    ]);

    bus.emit("task.changed", { bucket: "overflow", id: "first" });
    bus.emit("task.changed", { bucket: "overflow", id: "second" });
    bus.emit("task.changed", { bucket: "overflow", id: "third" });
    await wait(90);

    expect(processed).toHaveLength(2);
    expect(processed[0]).toMatchObject({
      reason: "overflow",
      count: 2,
      batch: { overflow: "flush-oldest", droppedInputCount: 0 },
    });
    expect(processed[0]!.inputEvents.map((entry) => entry.payload.id)).toEqual([
      "first",
      "second",
    ]);
    expect(processed[1]).toMatchObject({
      reason: "idle-timeout",
      count: 1,
      batch: { overflow: "flush-oldest", droppedInputCount: 0 },
    });
    expect(processed[1]!.inputEvents.map((entry) => entry.payload.id)).toEqual([
      "third",
    ]);
  });

  it("validates batch filters and grouping fields against module event declarations", () => {
    const event = defineProjectScopedModuleEvent<{ kind: string }>(
      "declared.event",
      ["kind"],
    );
    initModuleEventRegistry().register("declared", event);

    expect(() =>
      validateWorkflowDefinitions([
        registerWorkflowDefinition("test/invalid-batch.ts", {
          name: "invalid-batch",
          triggers: [
            {
              event: "declared.event",
              filter: { kind: "ok" },
              batch: {
                maxCount: 2,
                groupBy: "missing",
                maxBufferSize: 2,
                overflow: "flush-oldest",
              },
            },
          ],
          steps: [{ id: "noop", type: "code", run: () => undefined }],
        }),
      ]),
    ).toThrow(/batch\.groupBy references field "missing" not filterable/);

    expect(() =>
      validateWorkflowDefinitions([
        registerWorkflowDefinition("test/invalid-batch-filter.ts", {
          name: "invalid-batch-filter",
          triggers: [
            {
              event: "declared.event",
              filter: { missing: "nope" },
              batch: {
                maxCount: 2,
                groupBy: "kind",
                maxBufferSize: 2,
                overflow: "flush-oldest",
              },
            },
          ],
          steps: [{ id: "noop", type: "code", run: () => undefined }],
        }),
      ]),
    ).toThrow(/filter references field "missing" not filterable/);
  });

  it("preserves module event schema references on batch input envelopes", async () => {
    const projectDir = trackProjectDir();
    const bus = new EventBus();
    const pbus = new ProjectScopedEventBus(bus, "schema-batch-scope");
    const event = defineProjectScopedModuleEvent<{ kind: string; id: string }>(
      "declared.batch.input",
      ["kind", "id"],
      {
        schemaVersion: 2,
        payloadSchema: {
          type: "object",
          properties: {
            kind: { type: "string" },
            id: { type: "string" },
          },
        },
      },
    );
    initModuleEventRegistry().register("declared", event);
    const processed: WorkflowBatchFlushPayload[] = [];

    startRuntime(
      projectDir,
      bus,
      [
        {
          name: "schema-ref-batch",
          triggers: [
            {
              event: event.name,
              batch: {
                maxCount: 2,
                groupBy: "kind",
                maxBufferSize: 2,
                overflow: "flush-oldest",
              },
            },
          ],
          steps: [
            {
              id: "process",
              type: "code",
              run: (ctx) => {
                processed.push(ctx.trigger.payload as WorkflowBatchFlushPayload);
              },
            },
          ],
        },
      ],
      pbus,
    );

    pbus.emit(event, { kind: "alpha", id: "one" });
    pbus.emit(event, { kind: "alpha", id: "two" });
    await wait(80);

    expect(processed).toHaveLength(1);
    expect(processed[0]!.inputEvents.map((entry) => entry.schemaRef)).toEqual([
      { name: "declared.batch.input", version: 2 },
      { name: "declared.batch.input", version: 2 },
    ]);
  });
});
