import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { EventJournal, installEventJournal } from "#core/events/event-journal.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { initModuleLogStore, resetModuleLogStore } from "#core/modules/module-log.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import { hostActiveClock } from "#core/workflow/host-suspension.js";
import { subscribeModuleOperationFailures } from "#modules/autonomy/autonomy-issue-module-source.js";
import { readAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.js";
import { applyHealthReviewSignals, makeAutonomyIssueSourceContext } from "#modules/autonomy/autonomy-issue-sources.test-helpers.js";
import { type AutonomyHealthSignal, autonomyHealthSignal } from "#modules/autonomy/health-signal.js";
import { makeTelegramInteractiveChannel } from "#modules/telegram/channels.js";
import { ERROR_BACKOFF_MS } from "#modules/telegram/client.js";
import { createTelegramRuntimeState } from "#modules/telegram/runtime-state.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetModuleLogStore();
});

async function channelFixture() {
  vi.useFakeTimers();
  const root = mkdtempSync(join(tmpdir(), "telegram-health-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const bus = new EventBus();
  const { ctx: healthCtx, runtime } = makeAutonomyIssueSourceContext(root, bus);
  cleanups.push(() => runtime.runState.close());
  subscribeModuleOperationFailures(healthCtx);
  const journal = new EventJournal(join(root, ".kota", "events"));
  cleanups.push(installEventJournal(bus, journal));
  const signals: AutonomyHealthSignal[] = [];
  bus.on(autonomyHealthSignal, (signal) => signals.push(signal));
  const logs = initModuleLogStore(root);
  const loader = new ModuleLoader({
    modelProvider: { type: "openai", apiKey: "fixture-model-key" },
    serve: { defaultAutonomyMode: "supervised" },
    log: { format: "json" },
  });
  loader.setCwd(root);
  loader.setBus(bus);
  cleanups.push(() => loader.unloadAll());
  let moduleCtx!: ModuleRuntimeContext;
  await loader.load({ name: "telegram", onLoad(ctx) { moduleCtx = ctx; } });
  const pending: Array<{ operation: string; resolve: (response: Response) => void; reject: (error: Error) => void }> = [];
  const http = outboundHttpRequestPort((request) => new Promise<Response>((resolve, reject) => {
    const entry = { operation: request.operation, resolve, reject };
    pending.push(entry);
    const abort = () => {
      const index = pending.indexOf(entry);
      if (index !== -1) pending.splice(index, 1);
      reject(new Error("deliberate stop"));
    };
    if (request.signal?.aborted) abort();
    else request.signal?.addEventListener("abort", abort, { once: true });
  }));
  const reportFailure = vi.fn();
  const result = makeTelegramInteractiveChannel({
    cwd: moduleCtx.cwd,
    config: moduleCtx.config,
    verbose: moduleCtx.verbose,
    storage: moduleCtx.storage,
    getModuleConfig: moduleCtx.getModuleConfig,
    getProvider: moduleCtx.getProvider,
    log: moduleCtx.log,
    events: moduleCtx.events,
    get client() { return moduleCtx.client; },
    getSecret: (key) => key === "TELEGRAM_BOT_TOKEN" ? "fixture-token-secret" : "99",
  }, [], createTelegramRuntimeState(), http).create({
    moduleLoader: loader,
    getDefaultScopeRuntime: () => runtime,
    getScopeRuntime: () => runtime,
    log: () => {},
    reportFailure,
    getWorkflowStatus: () => { throw new Error("No status command in polling health probe"); },
  });
  if (result.status !== "started") throw new Error(JSON.stringify(result));
  cleanups.push(async () => {
    const stopped = result.adapter.stop();
    await vi.advanceTimersByTimeAsync(ERROR_BACKOFF_MS);
    await stopped;
  });
  await result.adapter.start();
  const flush = () => vi.advanceTimersByTimeAsync(0);
  const respond = async (operation: "getMe" | "getUpdates", errorCode?: number) => {
    const request = pending.shift()!;
    expect(request.operation).toBe(`telegram.${operation}`);
    request.resolve(Response.json(errorCode === undefined
      ? { ok: true, result: operation === "getMe" ? { id: 1, first_name: "Fixture" } : [] }
      : { ok: false, error_code: errorCode, description: `Provider failure fixture-token-secret (${errorCode})` }));
    await flush();
  };
  const fail = async () => {
    pending.shift()!.reject(new Error("network timeout fixture-token-secret"));
    await flush();
  };
  const retry = () => vi.advanceTimersByTimeAsync(ERROR_BACKOFF_MS);
  return { root, runtime, signals, logs, journal, pending, respond, fail, retry, reportFailure, adapter: result.adapter };
}

// Distinct composition failure: a retry caught inside the live bot must reach
// durable shared health even before the reviewer has projected any issue.
it("retains polling episodes for paused-review replay and one recurring issue lineage", async () => {
  const f = await channelFixture();
  expect(f.signals).toEqual([]);
  await f.respond("getMe");
  expect(f.signals).toEqual([]);
  await f.respond("getUpdates");
  expect(f.signals).toEqual([]);
  await f.respond("getUpdates");
  expect(f.signals).toEqual([]);
  await f.fail();
  await f.retry();
  await f.fail();
  await f.retry();
  await f.respond("getUpdates");
  await f.fail();
  await f.retry();
  await f.respond("getUpdates");
  await f.adapter.stop();
  expect(f.reportFailure).not.toHaveBeenCalled();
  expect(readAutonomyIssueProjection(f.root, join(f.root, ".kota")).issues).toEqual([]);

  const provider = f.signals.filter((signal) => signal.labels.includes("provider"));
  expect(provider.map((signal) => signal.observation)).toEqual(["present", "present", "cleared", "present", "cleared"]);
  expect(new Set(provider.map((signal) => signal.dedupeKey)).size).toBe(1);
  const replayed: AutonomyHealthSignal[] = [];
  new EventJournal(join(f.root, ".kota", "events")).replay({ type: autonomyHealthSignal.name, scopeId: f.runtime.scope.scopeId }, (envelope) => {
    replayed.push(envelope.payload as AutonomyHealthSignal);
  });
  expect(replayed).toEqual(f.signals);
  // Replay the repeated warning batch, then the later recovery and recurrence
  // batches through the existing reviewer admission policy.
  const providerReplay = replayed.filter((signal) => signal.labels.includes("provider"));
  const reviews = [providerReplay.slice(0, 2), ...providerReplay.slice(2).map((signal) => [signal])]
    .map((signals) => applyHealthReviewSignals({
      workspaceRoot: f.root, signals, generatedAt: signals.at(-1)!.createdAt, reason: "controlled-channel-replay",
    }));
  const projection = readAutonomyIssueProjection(f.root, join(f.root, ".kota"));
  expect(projection.issues).toHaveLength(1);
  expect(projection.issues[0]).toMatchObject({ status: "resolved", occurrenceCount: 3 });
  expect(reviews.flatMap((review) => review.taskMutations)).toEqual([]);
  expect(reviews.flatMap((review) => review.applied).map((action) => action.transition))
    .toEqual(["opened", "cleared", "reopened", "cleared"]);
  const entries = f.logs.tail("telegram", 30);
  expect(entries[0]).toMatchObject({ msg: expect.stringContaining("polling is not yet verified"), data: { scopeId: f.runtime.scope.scopeId } });
  expect(entries.filter((entry) => entry.level === "error")).toHaveLength(3);
  expect(entries.filter((entry) => entry.msg.includes("healthy getUpdates"))).toHaveLength(3);
  for (const entry of entries) {
    expect(Number.isFinite(Date.parse(entry.ts))).toBe(true);
    expect(entry.data).toMatchObject({ scopeId: f.runtime.scope.scopeId });
  }
  expect(JSON.stringify({ entries, events: f.journal.query() })).not.toContain("fixture-token-secret");
});

it("keeps startup retries failed until polling succeeds and cancels startup without failure", async () => {
  const f = await channelFixture();
  await f.fail();
  expect(f.signals.at(-1)?.observation).toBe("present");
  await f.retry();
  await f.respond("getMe");
  expect(f.signals.map((signal) => signal.observation)).toEqual(["present"]);
  await f.respond("getUpdates");
  expect(f.signals.filter((signal) => signal.labels.includes("provider")).map((signal) => signal.observation)).toEqual(["present", "cleared"]);
  await f.adapter.stop();
  const count = f.signals.length;
  await f.adapter.start();
  await f.adapter.stop();
  expect(f.signals).toHaveLength(count);
  await f.adapter.start();
  await f.fail();
  const stopping = f.adapter.stop();
  await f.retry();
  await stopping;
  expect(f.signals).toHaveLength(count + 1);
  expect(f.signals.at(-1)?.observation).toBe("present");
  expect(f.reportFailure).not.toHaveBeenCalled();
});

it("clears an observed poll conflict before issue projection and rearms conflict reporting", async () => {
  const f = await channelFixture();
  const conflict = async () => {
    const request = f.pending.shift()!;
    expect(request.operation).toBe("telegram.getUpdates");
    request.resolve(Response.json({
      ok: false, error_code: 409,
      description: "Conflict: terminated by other getUpdates request",
    }));
    await vi.advanceTimersByTimeAsync(0);
  };
  await f.respond("getMe");
  await conflict();
  await f.adapter.start();
  await f.respond("getMe");
  await conflict();
  expect(f.signals.map((signal) => signal.observation)).toEqual(["present"]);
  await f.adapter.start();
  await f.respond("getMe");
  expect(f.signals).toHaveLength(1);
  await f.respond("getUpdates");
  await conflict();
  expect(f.signals.map((signal) => signal.observation)).toEqual(["present", "cleared", "present"]);
  expect(new Set(f.signals.map((signal) => signal.dedupeKey)).size).toBe(1);
  expect(readAutonomyIssueProjection(f.root, join(f.root, ".kota")).issues).toEqual([]);
});

it("keeps verified host suspension diagnostic and reports a later unsuspended failure", async () => {
  const f = await channelFixture();
  await f.respond("getMe");
  await f.respond("getUpdates");
  vi.spyOn(hostActiveClock, "suspendedBetween").mockReturnValue(60_000);
  await vi.advanceTimersByTimeAsync(60_000);
  await f.fail();
  expect(f.signals.filter((signal) => signal.observation === "present")).toEqual([]);
  expect(f.logs.tail("telegram").at(-1)).toMatchObject({ level: "warn", data: { hostSuspendedMs: 60_000 } });
  await f.retry();
  await f.fail();
  expect(f.signals.at(-1)).toMatchObject({ observation: "present", labels: expect.arrayContaining(["provider"]) });
  await f.retry();
  await f.respond("getUpdates");
  expect(f.signals.at(-1)?.observation).toBe("cleared");
});

it.each(["getMe", "getUpdates"] as const)("reports terminal authentication at %s once without retry or recovery", async (operation) => {
  const f = await channelFixture();
  if (operation === "getUpdates") await f.respond("getMe");
  await f.respond(operation, 401);
  await f.retry();
  expect(f.pending).toEqual([]);
  expect(f.reportFailure).toHaveBeenCalledTimes(1);
  expect(f.signals).toEqual([expect.objectContaining({ observation: "present", labels: expect.arrayContaining(["auth"]) })]);
  expect(JSON.stringify(f.logs.tail("telegram"))).not.toContain("fixture-token-secret");
});

it.each(["non-JSON", "JSON"])("reports a %s HTTP authentication rejection without a Bot API envelope or retry", async (bodyKind) => {
  const f = await channelFixture();
  await f.respond("getMe");
  f.pending.shift()!.resolve(new Response(
    bodyKind === "JSON" ? JSON.stringify({ error: "forbidden fixture-token-secret" }) : "forbidden fixture-token-secret",
    { status: 403 },
  ));
  await f.retry();
  expect(f.pending).toEqual([]);
  expect(f.reportFailure).toHaveBeenCalledTimes(1);
  expect(f.signals).toEqual([expect.objectContaining({ observation: "present", labels: expect.arrayContaining(["auth"]) })]);
});
