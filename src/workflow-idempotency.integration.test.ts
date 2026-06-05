import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installEventIdempotency } from "#core/daemon/idempotency-events.js";
import { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { WorkflowRuntime } from "#core/workflow/runtime.js";
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

function makeProjectDir(): string {
  const projectDir = join(
    tmpdir(),
    `kota-workflow-idempotency-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(projectDir, { recursive: true });
  return projectDir;
}

function inboundPayload(receivedAt: string): InboundSignalReceivedPayload {
  return {
    scopeId: "scope-a",
    projectId: "scope-a",
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
  const projectDirs: string[] = [];
  const runtimes: WorkflowRuntime[] = [];

  afterEach(async () => {
    for (const runtime of runtimes.splice(0).reverse()) {
      await runtime.stop(0);
    }
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("dedupes repeated inbound signals before queueing duplicate workflow runs", async () => {
    const projectDir = makeProjectDir();
    projectDirs.push(projectDir);
    const bus = new EventBus();
    const pbus = new ProjectScopedEventBus(bus, "scope-a");
    const idempotencyStore = new IdempotencyStore(
      join(projectDir, ".kota", "idempotency"),
      "scope-a",
    );
    installEventIdempotency(bus, {
      defaultScopeId: "scope-a",
      resolveStore: () => idempotencyStore,
    });

    const processed: string[] = [];
    const runtime = new WorkflowRuntime({
      bus,
      pbus,
      projectDir,
      idempotencyStore,
      idleIntervalMs: 60_000,
      workflows: [
        {
          name: "inbound-signal-dedupe-fixture",
          definitionPath: "src/workflow-idempotency.integration.test.ts",
          moduleRoot: process.cwd(),
          enabled: true,
          recoveryCapable: false,
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
    expect(idempotencyStore.list({ operation: "workflow-dispatch" })).toHaveLength(1);
  });
});
