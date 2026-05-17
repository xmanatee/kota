/**
 * Verifies the push-notification module's bus subscriptions wire each
 * supported event to an Expo Push API fan-out:
 *
 * - `approval.requested` → `data.screen = "approvals"` (existing behavior).
 * - `workflow.daily.digest` → `data.screen = "digest"`, cadence-posture title.
 * - `workflow.attention.digest` → `data.screen = "attention"`, attention-posture
 *   title, so a tap deep-links into the mobile AttentionScreen instead of the
 *   daily-digest screen.
 *
 * The module is exercised through its real `onLoad` against a stub
 * `ModuleRuntimeContext` whose event proxy is backed by a real `EventBus`. Each
 * test emits the corresponding event and asserts the resulting `fetch`
 * payload. `onUnload` is also exercised: after unload, the bus has no
 * listeners for the three events, proving every subscription is released.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import pushNotificationModule from "./index.js";

const REGISTERED_TOKEN = "ExponentPushToken[aaa]";

function makeStubCtx(cwd: string, bus: EventBus): ModuleRuntimeContext {
  return {
    cwd,
    verbose: false,
    config: {} as ModuleRuntimeContext["config"],
    storage: new ModuleStorage(cwd, "push-notification"),
    registerGroup: () => {},
    getRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
    getContributedControlRoutes: () => [],
    getModuleSummaries: () => [],
    getModuleConfig: () => undefined,
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getSecret: () => null,
    listTools: () => [],
    events: makeStubEventProxy(bus),
    createSession: () => ({ send: async () => "", close: () => {} }),
    registerProvider: () => {},
    getProvider: () => null,
    callTool: async () => ({ content: "" }),
    registerMiddleware: () => {},
    registerDynamicStateProvider: () => {},
    registerCleanupHook: () => {},
    registerPreSendHook: () => {},
    registerHarnessHook: () => {},
    resolveAgentDef: () => undefined,
    resolveSkillsPrompt: () => "",
    probeHealthChecks: async () => ({}),
    getRegisteredConfigKeys: () => new Set<string>(),
    client: {} as never,
  };
}

describe("pushNotificationModule bus subscriptions", () => {
  let projectDir: string;
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;
  let bus: EventBus;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-push-module-"));
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota/push-tokens.json"),
      JSON.stringify({
        tokens: {
          "device-a": {
            deviceId: "device-a",
            token: REGISTERED_TOKEN,
            registeredAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }),
    );

    originalFetch = globalThis.fetch;
    fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    bus = new EventBus();
    pushNotificationModule.onLoad!(makeStubCtx(projectDir, bus));
  });

  afterEach(() => {
    pushNotificationModule.onUnload!();
    globalThis.fetch = originalFetch;
    rmSync(projectDir, { recursive: true, force: true });
  });

  async function flushFetch(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
  }

  it("fans approval.requested out as a screen=approvals push", async () => {
    bus.emit("approval.requested", {
      id: "approval-7",
      tool: "shell",
      risk: "moderate",
      source: "session",
      reason: "test",
      sessionId: "session",
    });
    await flushFetch();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Array<Record<string, unknown>>;
    expect(body[0]).toMatchObject({
      to: REGISTERED_TOKEN,
      title: "session — shell",
      data: { screen: "approvals", approvalId: "approval-7" },
    });
  });

  it("fans workflow.daily.digest out as a screen=digest push with cadence title", async () => {
    bus.emit("workflow.daily.digest", {
      windowStartedAt: "2026-04-25T08:00:00.000Z",
      windowEndedAt: "2026-04-26T08:00:00.000Z",
      text: "Daily digest 2026-04-26\n- builder committed: Add foo",
      quiet: false,
    });
    await flushFetch();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Array<Record<string, unknown>>;
    expect(body[0]).toEqual({
      to: REGISTERED_TOKEN,
      sound: "default",
      title: "KOTA daily digest",
      body: "Daily digest 2026-04-26",
      data: { screen: "digest" },
    });
  });

  it("fans workflow.attention.digest out as a screen=attention push with attention title", async () => {
    bus.emit("workflow.attention.digest", {
      items: [{ kind: "pending-owner-question", id: "abc" }],
      text: "Attention required 2026-04-26\n- owner question pending",
    });
    await flushFetch();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Array<Record<string, unknown>>;
    expect(body[0]).toEqual({
      to: REGISTERED_TOKEN,
      sound: "default",
      title: "KOTA needs your attention",
      body: "Attention required 2026-04-26",
      data: { screen: "attention" },
    });
  });

  it("releases every subscription on unload", () => {
    pushNotificationModule.onUnload!();
    expect(bus.listenerCount("approval.requested")).toBe(0);
    expect(bus.listenerCount("workflow.daily.digest")).toBe(0);
    expect(bus.listenerCount("workflow.attention.digest")).toBe(0);
  });
});
