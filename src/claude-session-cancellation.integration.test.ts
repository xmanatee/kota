import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import { runAgentHarness } from "#core/agent-harness/runner.js";
import { resetAgentConversation } from "#core/agent-harness/session-continuity.js";
import { buildDirectoryScope } from "#core/daemon/scope-registry.js";
import { createScopeRuntime } from "#core/daemon/scope-runtime.js";
import { EventBus } from "#core/events/event-bus.js";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import { RunCoordinator } from "#core/workflow/run-coordinator.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { claudeAgentHarness } from "#modules/claude-agent-harness/adapter.js";
import type { SDKQueryOptions } from "#modules/claude-agent-harness/sdk-types.js";
import { TelegramMessageRuntime } from "#modules/telegram/bot-message-runtime.js";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@anthropic-ai/claude-agent-sdk", async (original) => ({
  ...await original<typeof import("@anthropic-ai/claude-agent-sdk")>(),
  query,
}));

// The SDK may flush its mirror after cancellation reaches the shared runner.
// A replacement must not enter that conversation until the SDK iterator drains.
it.each(["before cancellation", "during shutdown"])("retains cancelled Claude ownership when identity first arrives %s", async (identityTiming) => {
  const root = mkdtempSync(join(tmpdir(), "kota-claude-cancel-"));
  const sessionId = randomUUID();
  const key = { projectKey: root.replace(/[^a-zA-Z0-9]/g, "-"), sessionId };
  const abortController = new AbortController();
  let releaseQuery!: () => void;
  const waiting = new Promise<void>((resolve) => { releaseQuery = resolve; });
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  let drained = false;
  let loaded: unknown;
  query.mockImplementation(({ options }: { options: SDKQueryOptions }) => (async function* () {
    const store = options.sessionStore!;
    if (options.resume === undefined) {
      if (identityTiming === "before cancellation") {
        await store.append(key, [{ type: "user", uuid: "first", sessionId, cwd: root, message: { role: "user", content: "Remember blue" } }]);
        yield { type: "system", subtype: "init", session_id: sessionId };
      }
      ready();
      try { await waiting; }
      finally {
        if (identityTiming === "during shutdown") await store.append(key, [{ type: "user", uuid: "first", sessionId, cwd: root, message: { role: "user", content: "Remember blue" } }]);
        await store.append(key, [{ type: "assistant", uuid: "late", sessionId, message: { role: "assistant", content: [{ type: "text", text: "Retained final mirror write" }] } }]);
        drained = true;
      }
    } else {
      loaded = await store.load(key);
    }
    yield { type: "result", subtype: "success", session_id: sessionId, result: "done" };
  })());
  const options = { prompt: "work", effort: "high" as const, scopeRoot: root, cwd: root, continuityKey: "owner" };
  const observedIdentity = vi.fn();
  try {
    const pending = runAgentHarness(claudeAgentHarness, { ...options, abortController, onSessionId: observedIdentity });
    await started;
    abortController.abort(new Error("cancelled by owner"));
    await expect(pending).rejects.toThrow("cancelled by owner");
    expect(drained).toBe(false);
    observedIdentity.mockClear();
    await expect(runAgentHarness(claudeAgentHarness, options)).rejects.toThrow("active owner");
    if (identityTiming === "before cancellation") await expect(runAgentHarness(claudeAgentHarness, { ...options, continuityKey: undefined, resumeSessionId: sessionId })).rejects.toThrow("active owner");
    expect(() => resetAgentConversation(root, "owner", "explicit reset")).toThrow("active owner");
    releaseQuery();
    // Drain promise callbacks from the controlled SDK shutdown without retrying admission.
    await setImmediate();
    expect(drained).toBe(true);
    expect(observedIdentity).not.toHaveBeenCalled();
    const resumed = await runAgentHarness(claudeAgentHarness, options);
    expect(resumed.sessionId).toBe(sessionId);
    expect(JSON.stringify(loaded)).toContain("Remember blue");
    expect(JSON.stringify(loaded)).toContain("Retained final mirror write");
    expect(query).toHaveBeenCalledTimes(2);
  } finally {
    releaseQuery();
    await setImmediate();
    query.mockReset();
    rmSync(root, { recursive: true, force: true });
  }
});

// Drive /clear through the real Telegram command/cache, runner, and Claude store.
// Only the SDK query and Telegram HTTP ports are controlled.
it("clears an active Telegram conversation after Claude drains, then sends with a fresh cached agent", async () => {
  const root = mkdtempSync(join(tmpdir(), "kota-telegram-clear-"));
  const scope = buildDirectoryScope({ scopeRoot: root });
  const runState = new RunStateDatabase(join(root, ".kota"));
  const createdAt = new Date().toISOString();
  runState.registerScope({ id: scope.scopeId, rootPath: root, displayName: scope.displayName, createdAt });
  const daemonEpoch = runState.beginDaemonSession(createdAt).epoch;
  const runCoordinator = new RunCoordinator({
    store: runState, daemonEpoch, concurrency: 1,
    execute: (run, signal) => runtime.workflowRuntime.executeAdmittedRun(run, signal),
  });
  const runtime = createScopeRuntime({
    scope, bus: new EventBus(), onLog: () => {}, installSingletons: false,
    runState, runCoordinator, daemonEpoch,
  });
  class TelegramCommands extends TelegramMessageRuntime {
    dispatch(text: string) { return this.handleMessage(7, text); }
    close() { return this.closeSessionsForChat(7); }
  }
  const replies: string[] = [];
  const http = outboundHttpRequestPort((request) => {
    if (String(request.url).endsWith("/sendMessage")) {
      replies.push(JSON.parse(String(request.body)).text);
    }
    return Response.json({ ok: true, result: {} });
  });
  const bot = new TelegramCommands({
    token: "123:controlled", autonomyMode: "autonomous", http,
    config: { defaultAgentHarness: claudeAgentHarness.name, model: "controlled" },
    defaultScopeRuntime: runtime, getScopeRuntime: () => runtime,
  });
  const unregister = registerAgentHarness(claudeAgentHarness);
  const previousPreset = process.env.KOTA_PRESET;
  delete process.env.KOTA_PRESET;
  let release!: () => void;
  const draining = new Promise<void>((resolve) => { release = resolve; });
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  const firstId = randomUUID();
  let oldEntries: unknown;
  let loadOldEntries!: () => Promise<void>;
  let calls = 0;
  query.mockImplementation(({ options }: { options: SDKQueryOptions }) => (async function* () {
    expect(options.resume).toBeUndefined();
    const sessionId = calls++ === 0 ? firstId : randomUUID();
    const key = { projectKey: root.replace(/[^a-zA-Z0-9]/g, "-"), sessionId };
    if (sessionId === firstId) {
      ready();
      await draining;
      await options.sessionStore!.append(key, [{ type: "user", uuid: "old", sessionId, cwd: root, message: { role: "user", content: "Retired conversation evidence" } }]);
      loadOldEntries = async () => { oldEntries = await options.sessionStore!.load(key); };
    }
    yield { type: "result", subtype: "success", session_id: sessionId, result: "Fresh conversation reply" };
  })());
  let clear: Promise<void> | undefined;
  try {
    const send = bot.dispatch("Remember old context");
    await started;
    clear = bot.dispatch("/clear");
    // Handle cancellation without allowing a rejected reset to escape the test.
    const cleared = clear.then(() => "cleared", (error: Error) => error.message);
    const repeatedClear = bot.dispatch("/clear").then(() => "cleared", (error: Error) => error.message);
    await send;
    await setImmediate();
    expect(replies).not.toContain("Conversation cleared.");
    await bot.dispatch("Message while clearing");
    expect(replies).toContain("Conversation is being cleared. Please wait.");
    release();
    expect(await cleared).toBe("cleared");
    expect(await repeatedClear).toBe("cleared");
    await loadOldEntries();
    expect(JSON.stringify(oldEntries)).toContain("Retired conversation evidence");
    replies.length = 0;
    await bot.dispatch("Start new context");
    expect(calls).toBe(2);
    expect(replies).toContain("Fresh conversation reply");
    expect(replies.some((text) => text.includes("closed") || text.includes("active owner"))).toBe(false);
  } finally {
    release();
    await clear?.catch(() => {});
    await bot.close();
    unregister();
    query.mockReset();
    if (previousPreset === undefined) delete process.env.KOTA_PRESET;
    else process.env.KOTA_PRESET = previousPreset;
    runtime.scheduler.stopTimer();
    runtime.scheduler.disconnectBus();
    await runtime.workflowRuntime.stop();
    runState.close();
    rmSync(root, { recursive: true, force: true });
  }
});
