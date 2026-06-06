import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createConfirmedActionDeadLetter,
  createEventEnvelopeDeadLetter,
  DeadLetterQueueStore,
} from "#core/daemon/dead-letter-queue.js";
import { EventBus } from "#core/events/event-bus.js";
import {
  EventJournal,
  installEventJournal,
} from "#core/events/event-journal.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { deregisterTool, registerTool } from "#core/tools/index.js";
import { WorkflowRuntime } from "./runtime.js";
import type { RegisteredWorkflowDefinitionInput } from "./types.js";

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

function makeProjectDir(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "kota-workflow-dlq-"));
  mkdirSync(join(projectDir, ".kota"), { recursive: true });
  return projectDir;
}

function startRuntime(input: {
  projectDir: string;
  bus: EventBus;
  pbus: ProjectScopedEventBus;
  deadLetterQueue: DeadLetterQueueStore;
  eventJournal?: EventJournal;
  workflows: RegisteredWorkflowDefinitionInput[];
}): WorkflowRuntime {
  const runtime = new WorkflowRuntime({
    bus: input.bus,
    pbus: input.pbus,
    projectDir: input.projectDir,
    deadLetterQueue: input.deadLetterQueue,
    eventJournal: input.eventJournal,
    idleIntervalMs: 60_000,
    workflows: input.workflows,
  });
  runtime.start();
  return runtime;
}

describe("workflow dead-letter queue integration", () => {
  let projectDir: string;
  let bus: EventBus;
  let pbus: ProjectScopedEventBus;
  let store: DeadLetterQueueStore;

  beforeEach(() => {
    projectDir = makeProjectDir();
    bus = new EventBus();
    pbus = new ProjectScopedEventBus(bus, "scope-a");
    store = new DeadLetterQueueStore(join(projectDir, ".kota", "dead-letter-queue"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("parks event-triggered workflow validation failures with the durable event id", async () => {
    bus.addEmitMiddleware((envelope, next) => {
      if (envelope.type === "telegram.message") envelope.eventId = "evtj-000000000001";
      next();
    });
    const runtime = startRuntime({
      projectDir,
      bus,
      pbus,
      deadLetterQueue: store,
      workflows: [
        {
          name: "telegram-validation",
          definitionPath: "src/core/workflow/dead-letter-queue.test.ts",
          moduleRoot: process.cwd(),
          inputSchema: {
            type: "object",
            required: ["text"],
            properties: { text: { type: "string" } },
            additionalProperties: true,
          },
          triggers: [{ event: "telegram.message", cooldownMs: 0 }],
          steps: [{ id: "noop", type: "code", run: () => ({ ok: true }) }],
        },
      ],
    });

    pbus.emitDynamic("telegram.message", {
      chatId: "chat-1",
      message: { text: "nested" },
      botToken: "secret-token",
    });
    await waitUntil(() => store.list().length === 1, "timed out waiting for DLQ item");
    await runtime.stop();

    const item = store.list()[0]!;
    expect(item).toMatchObject({
      type: "workflow-dispatch",
      status: "open",
      scopeId: "scope-a",
      affectedWorkflowNames: ["telegram-validation"],
      failure: { lastErrorClass: "validation" },
      sourceEventIds: ["evtj-000000000001"],
    });
    expect(item.redactedProjection.triggerPayload).toMatchObject({
      chatId: "chat-1",
      message: { text: "nested" },
      botToken: "[redacted]",
    });
    expect(runtime.getState().completedRuns).toBe(0);
  });

  it("redrives a failed Telegram-like event after the fixture schema is fixed", async () => {
    const eventJournal = new EventJournal(join(projectDir, ".kota", "events"));
    installEventJournal(bus, eventJournal);
    const failingWorkflow: RegisteredWorkflowDefinitionInput = {
      name: "telegram-redrive-fixture",
      definitionPath: "src/core/workflow/dead-letter-queue.test.ts",
      moduleRoot: process.cwd(),
      triggers: [{ event: "telegram.message", cooldownMs: 0 }],
      steps: [
        {
          id: "parse",
          type: "code",
          run: (ctx) => {
            if (typeof ctx.trigger.payload.text !== "string") {
              throw new Error("telegram fixture expected text at the top level");
            }
            return { text: ctx.trigger.payload.text };
          },
        },
      ],
    };
    const runtime = startRuntime({
      projectDir,
      bus,
      pbus,
      deadLetterQueue: store,
      eventJournal,
      workflows: [failingWorkflow],
    });

    pbus.emitDynamic("telegram.message", {
      chatId: "chat-1",
      retryOf: "2026-06-06T11-59-00-000Z-telegram-redrive-fixture-oldrun",
      message: { text: "nested text" },
      botToken: "secret-token",
    });
    await waitUntil(
      () => store.list({ status: "open" }).length === 1 && !runtime.isBusy(),
      "timed out waiting for failed workflow DLQ item",
    );
    await runtime.stop();

    const failedItem = store.list({ status: "open" })[0]!;
    expect(failedItem).toMatchObject({
      type: "workflow-dispatch",
      scopeId: "scope-a",
      failure: {
        lastErrorClass: "execution",
        retryCount: 1,
      },
      sourceEventIds: ["evtj-000000000002"],
      source: {
        kind: "workflow-dispatch",
        workflowName: "telegram-redrive-fixture",
      },
    });
    if (failedItem.source.kind !== "workflow-dispatch") {
      throw new Error("expected workflow dispatch dead-letter source");
    }
    expect(failedItem.source.failedRunId).toBeTruthy();

    const processed: string[] = [];
    const fixedBus = new EventBus();
    const fixedRuntime = startRuntime({
      projectDir,
      bus: fixedBus,
      pbus: new ProjectScopedEventBus(fixedBus, "scope-a"),
      deadLetterQueue: store,
      eventJournal,
      workflows: [
        {
          ...failingWorkflow,
          steps: [
            {
              id: "parse",
              type: "code",
              run: (ctx) => {
                const message = ctx.trigger.payload.message;
                if (!message || typeof message !== "object" || Array.isArray(message)) {
                  throw new Error("telegram fixture message is missing");
                }
                const text = (message as Record<string, unknown>).text;
                if (typeof text !== "string") {
                  throw new Error("telegram fixture nested text is missing");
                }
                processed.push(`${text}:${ctx.trigger.payload.botToken}`);
                return { text };
              },
            },
          ],
        },
      ],
    });
    const redrive = fixedRuntime.redriveDeadLetter(
      failedItem.id,
      "fixture schema fixed to read nested message.text",
      "original",
    );
    expect(redrive).toMatchObject({
      ok: true,
      workflowName: "telegram-redrive-fixture",
    });
    await waitUntil(
      () => processed.includes("nested text:secret-token") && !fixedRuntime.isBusy(),
      "timed out waiting for redriven workflow run",
    );
    await fixedRuntime.stop();

    const redriven = store.get(failedItem.id)!;
    expect(redriven.status).toBe("redriven");
    expect(redriven.redriveAttempts).toMatchObject([
      {
        target: "original",
        reason: "fixture schema fixed to read nested message.text",
        result: {
          status: "queued",
          runId: redrive.runId,
          workflowName: "telegram-redrive-fixture",
        },
      },
    ]);
  });

  it("redrives a batch with original input payloads from the event journal", async () => {
    const eventJournal = new EventJournal(join(projectDir, ".kota", "events"));
    installEventJournal(bus, eventJournal);
    const failingWorkflow: RegisteredWorkflowDefinitionInput = {
      name: "telegram-batch-redrive-fixture",
      definitionPath: "src/core/workflow/dead-letter-queue.test.ts",
      moduleRoot: process.cwd(),
      inputSchema: {
        type: "object",
        required: ["accepted"],
        properties: { accepted: { type: "boolean" } },
        additionalProperties: true,
      },
      triggers: [
        {
          event: "telegram.batch",
          cooldownMs: 0,
          batch: {
            groupBy: "chatId",
            maxCount: 2,
            maxBufferSize: 10,
            overflow: "flush-oldest",
          },
        },
      ],
      steps: [{ id: "noop", type: "code", run: () => ({ ok: true }) }],
    };
    const runtime = startRuntime({
      projectDir,
      bus,
      pbus,
      deadLetterQueue: store,
      eventJournal,
      workflows: [failingWorkflow],
    });

    pbus.emitDynamic("telegram.batch", {
      chatId: "chat-1",
      text: "one",
      botToken: "secret-one",
    });
    pbus.emitDynamic("telegram.batch", {
      chatId: "chat-1",
      text: "two",
      botToken: "secret-two",
    });
    await waitUntil(
      () => store.list({ type: "batch-envelope", status: "open" }).length === 1,
      "timed out waiting for batch DLQ item",
    );
    await runtime.stop();

    const item = store.list({ type: "batch-envelope", status: "open" })[0]!;
    expect(item.redactedProjection.inputEvents).toMatchObject([
      { payload: { botToken: "[redacted]" } },
      { payload: { botToken: "[redacted]" } },
    ]);

    const observedTokens: string[] = [];
    const fixedBus = new EventBus();
    const fixedRuntime = startRuntime({
      projectDir,
      bus: fixedBus,
      pbus: new ProjectScopedEventBus(fixedBus, "scope-a"),
      deadLetterQueue: store,
      eventJournal,
      workflows: [
        {
          ...failingWorkflow,
          inputSchema: undefined,
          steps: [
            {
              id: "inspect",
              type: "code",
              run: (ctx) => {
                const payload = ctx.trigger.payload as {
                  inputEvents: Array<{ payload: Record<string, unknown> }>;
                };
                observedTokens.push(
                  ...payload.inputEvents.map((event) => String(event.payload.botToken)),
                );
                return { ok: true };
              },
            },
          ],
        },
      ],
    });

    const redrive = fixedRuntime.redriveDeadLetter(
      item.id,
      "batch schema fixed",
      "original",
    );
    expect(redrive).toMatchObject({
      ok: true,
      workflowName: "telegram-batch-redrive-fixture",
    });
    await waitUntil(
      () => observedTokens.includes("secret-one") && observedTokens.includes("secret-two") && !fixedRuntime.isBusy(),
      "timed out waiting for redriven batch run",
    );
    await fixedRuntime.stop();
  });

  it("redrives event-envelope items back onto the scoped event bus", async () => {
    const eventJournal = new EventJournal(join(projectDir, ".kota", "events"));
    const received: Record<string, unknown>[] = [];
    bus.on("telegram.message", (payload) => {
      received.push(payload);
    });
    const runtime = startRuntime({
      projectDir,
      bus,
      pbus,
      deadLetterQueue: store,
      eventJournal,
      workflows: [],
    });
    const envelope = eventJournal.appendFromBusEnvelope({
      type: "telegram.message",
      schemaRef: null,
      payload: {
        scopeId: "scope-a",
        projectId: "scope-a",
        chatId: "chat-1",
        text: "hello",
        botToken: "secret-token",
      },
    });
    const item = createEventEnvelopeDeadLetter({
      store,
      scopeId: "scope-a",
      envelope,
      reason: "event schema rejected payload",
      errorClass: "validation",
    });

    const redrive = runtime.redriveDeadLetter(
      item.id,
      "event schema accepts the payload",
      "original",
    );
    await runtime.stop();

    expect(redrive).toEqual({ ok: true, event: "telegram.message" });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      chatId: "chat-1",
      text: "hello",
      botToken: "secret-token",
      scopeId: "scope-a",
      projectId: "scope-a",
      redriveOf: item.id,
      redriveReason: "event schema accepts the payload",
      causationId: item.id,
      sourceEventIds: ["evtj-000000000001"],
    });
    const redriven = store.get(item.id)!;
    expect(redriven.status).toBe("redriven");
    expect(redriven.redriveAttempts[0]).toMatchObject({
      target: "original",
      result: { status: "emitted", event: "telegram.message" },
    });
  });

  it("redrives confirmed-action dispatch items as workflow resume runs", async () => {
    const executed: string[] = [];
    const failingWorkflow: RegisteredWorkflowDefinitionInput = {
      name: "confirmed-action-redrive-fixture",
      definitionPath: "src/core/workflow/dead-letter-queue.test.ts",
      moduleRoot: process.cwd(),
      triggers: [{ event: "confirmed.action", cooldownMs: 0 }],
      steps: [
        { id: "prepare", type: "code", run: () => ({ ready: true }) },
        { id: "book", type: "code", run: () => { throw new Error("adapter failed"); } },
      ],
    };
    const runtime = startRuntime({
      projectDir,
      bus,
      pbus,
      deadLetterQueue: store,
      workflows: [failingWorkflow],
    });

    pbus.emitDynamic("confirmed.action", { action: "book" });
    await waitUntil(
      () => store.list({ type: "workflow-dispatch", status: "open" }).length === 1 && !runtime.isBusy(),
      "timed out waiting for failed source run",
    );
    await runtime.stop();

    const sourceRunId = store.list({ type: "workflow-dispatch", status: "open" })[0]!.source;
    if (sourceRunId.kind !== "workflow-dispatch" || sourceRunId.failedRunId === undefined) {
      throw new Error("expected failed workflow source run");
    }
    const item = createConfirmedActionDeadLetter({
      store,
      scopeId: "scope-a",
      decisionId: "decision-1",
      actionId: "book-court",
      adapterName: "sports-booking",
      workflowName: "confirmed-action-redrive-fixture",
      runId: sourceRunId.failedRunId,
      stepId: "book",
      reason: "adapter failed",
      redactedInput: { slot: "7pm" },
    });

    const fixedBus = new EventBus();
    const fixedRuntime = startRuntime({
      projectDir,
      bus: fixedBus,
      pbus: new ProjectScopedEventBus(fixedBus, "scope-a"),
      deadLetterQueue: store,
      workflows: [
        {
          ...failingWorkflow,
          steps: [
            { id: "prepare", type: "code", run: () => ({ ready: true }) },
            { id: "book", type: "code", run: () => { executed.push("book"); return { ok: true }; } },
          ],
        },
      ],
    });

    const redrive = fixedRuntime.redriveDeadLetter(
      item.id,
      "booking adapter fixed",
      "original",
    );
    expect(redrive).toMatchObject({
      ok: true,
      workflowName: "confirmed-action-redrive-fixture",
    });
    await waitUntil(
      () => executed.includes("book") && !fixedRuntime.isBusy(),
      "timed out waiting for confirmed-action redrive",
    );
    await fixedRuntime.stop();
  });

  it("parks workflow dispatch execution failures after configured step retry exhaustion", async () => {
    const toolName = `dlq_retry_fixture_${Math.random().toString(36).slice(2, 8)}`;
    let attempts = 0;
    registerTool(
      {
        name: toolName,
        description: "DLQ retry exhaustion fixture",
        input_schema: { type: "object", properties: {} },
      },
      async () => {
        attempts += 1;
        throw new Error(`fixture provider failure ${attempts}`);
      },
    );
    let runtime: WorkflowRuntime | undefined;
    try {
      runtime = startRuntime({
        projectDir,
        bus,
        pbus,
        deadLetterQueue: store,
        workflows: [
          {
            name: "retry-exhaustion-fixture",
            definitionPath: "src/core/workflow/dead-letter-queue.test.ts",
            moduleRoot: process.cwd(),
            triggers: [{ event: "telegram.retry", cooldownMs: 0 }],
            steps: [
              {
                id: "send",
                type: "tool",
                tool: toolName,
                retry: { maxAttempts: 3, initialDelayMs: 1, backoffFactor: 1 },
              },
            ],
          },
        ],
      });

      pbus.emitDynamic("telegram.retry", {
        chatId: "chat-1",
        text: "send this",
      });
      await waitUntil(
        () => store.list({ status: "open" }).length === 1 && !runtime!.isBusy(),
        "timed out waiting for retry-exhausted workflow DLQ item",
      );
      await runtime.stop();
    } finally {
      deregisterTool(toolName);
      if (runtime?.isBusy()) await runtime.stop(1, 1);
    }

    expect(attempts).toBe(3);
    const item = store.list({ status: "open" })[0]!;
    expect(item).toMatchObject({
      type: "workflow-dispatch",
      status: "open",
      scopeId: "scope-a",
      affectedWorkflowNames: ["retry-exhaustion-fixture"],
      failure: {
        lastErrorClass: "execution",
        retryCount: 3,
      },
      source: {
        kind: "workflow-dispatch",
        workflowName: "retry-exhaustion-fixture",
        failedRunId: expect.any(String),
      },
    });
    expect(item.redactedProjection.triggerPayload).toMatchObject({
      chatId: "chat-1",
      text: "send this",
    });
  });
});
