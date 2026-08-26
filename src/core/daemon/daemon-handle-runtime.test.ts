import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import type { BusEvents } from "#core/events/event-bus-types.js";
import { ScopedEventBus } from "#core/events/scope.js";
import type { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { WorkflowRuntime } from "#core/workflow/runtime.js";
import { buildDaemonHandle } from "./daemon-handle.js";
import {
  makeWorkflowRunSubject,
} from "./daemon-handle-test-support.integration.js";
import type { ScopeRegistry } from "./scope-registry.js";
import type { ScopeRuntime, ScopeRuntimeRegistry } from "./scope-runtime.js";

describe("buildDaemonHandle workflow run projections", () => {
  it("redacts trigger payload values in client-facing run detail", () => {
    const metadata: WorkflowRunMetadata = {
      id: "run-redaction",
      workflow: "builder",
      definitionPath: "workflow.ts",
      trigger: {
        event: "manual",
        schemaRef: null,
        payload: {
          source: "test",
          token: "raw-token",
          authorization: "Bearer raw-auth",
          email: "owner@example.test",
          providerPayload: { secret: "provider-secret", visible: "provider-data" },
          nested: {
            password: "raw-password",
            label: "visible",
          },
        },
      },
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "success",
      runDir: ".kota/runs/run-redaction",
      steps: [],
      warnings: [{ type: "output-schema-mismatch", message: "email owner@example.test" }],
    };
    const handle = makeWorkflowRunSubject(metadata);

    const run = handle.getWorkflowRun("run-redaction");

    expect(run?.triggerPayload).toMatchObject({
      source: "test",
      token: "[redacted]",
      authorization: "[redacted]",
      email: "[redacted]",
      providerPayload: {
        redacted: true,
        reason: "provider-payload",
      },
      nested: {
        password: "[redacted]",
        label: "visible",
      },
    });
    expect(run?.warnings).toEqual([
      { type: "output-schema-mismatch", message: "email [redacted]" },
    ]);
    expect(JSON.stringify(run)).not.toContain("raw-token");
    expect(JSON.stringify(run)).not.toContain("Bearer raw-auth");
    expect(JSON.stringify(run)).not.toContain("owner@example.test");
    expect(JSON.stringify(run)).not.toContain("provider-secret");
    expect(JSON.stringify(run)).not.toContain("raw-password");
  });
});

describe("buildDaemonHandle sessions", () => {
  it("attributes serve-registered sessions to the selected scope", () => {
    const bus = new EventBus();
    const registered: BusEvents["session.registered"][] = [];
    const unregistered: BusEvents["session.unregistered"][] = [];
    bus.on("session.registered", (payload) => registered.push(payload));
    bus.on("session.unregistered", (payload) => unregistered.push(payload));

    const workflowRuntime = {
      getDefinitionCount: vi.fn(() => 0),
      enqueuePendingRun: vi.fn(() => ({ ok: true, queued: "builder" })),
    };
    const runtimeA = {
      pbus: new ScopedEventBus(bus, "scope-a"),
      workflowRuntime,
    } as unknown as ScopeRuntime;
    const runtimeB = {
      pbus: new ScopedEventBus(bus, "scope-b"),
      workflowRuntime,
    } as unknown as ScopeRuntime;
    const runtimes = new Map([
      ["scope-a", runtimeA],
      ["scope-b", runtimeB],
    ]);
    const scopeRuntimes = {
      list: vi.fn(() => [runtimeA, runtimeB]),
      getDefault: vi.fn(() => runtimeA),
      get: vi.fn((scopeId: string) => {
        const runtime = runtimes.get(scopeId);
        if (!runtime) throw new Error(`unknown scope ${scopeId}`);
        return runtime;
      }),
    } as unknown as ScopeRuntimeRegistry;
    const scopeRegistry = {
      get: vi.fn((scopeId: string) =>
        scopeId === "scope-a" || scopeId === "scope-b"
          ? { scopeId }
          : undefined,
      ),
      getDefaultScopeId: vi.fn(() => "scope-a"),
      toProjection: vi.fn(() => ({ defaultScopeId: "scope-a", scopes: [] })),
    } as unknown as ScopeRegistry;
    let scopeBHostingState: "hosted" | "draining" | "drained" = "hosted";
    const handle = buildDaemonHandle({
      getState: () => ({
        startedAt: "2026-01-01T00:00:00.000Z",
        pid: 1234,
      }),
      isRunning: () => true,
      workflows: workflowRuntime as unknown as WorkflowRuntime,
      bus,
      sessions: new Map(),
      runStore: {} as WorkflowRunStore,
      scopeRoot: mkdtempSync(join(tmpdir(), "kota-daemon-session-test-")),
      scopeRegistry,
      scopeRuntimes,
      getScopeHostingState: (scopeId) =>
        scopeId === "scope-b" ? scopeBHostingState : "hosted",
      config: { config: {}, verbose: false },
      refreshLiveSessionGuardrails: () => ({ refreshed: 0, unchanged: 0 }),
      log: () => {},
      getModuleSummaries: () => [],
      getModuleHealthChecks: () => ({}),
      probeCapabilityReadiness: async () => ({
        capabilities: [],
        summary: { ready: 0, unavailable: 0, init_failed: 0 },
      }),
      getChannelStatuses: () => [],
    });

    handle.registerSession(
      "serve-b",
      "2026-01-01T00:00:00.000Z",
      "supervised",
      "scope-b",
    );

    expect(handle.listSessions("scope-a")).toEqual([]);
    expect(handle.listSessions("scope-b")).toMatchObject([
      {
        id: "serve-b",
        scopeId: "scope-b",
        source: "serve",
      },
    ]);
    expect(registered).toEqual([
      {
        id: "serve-b",
        scopeId: "scope-b",
        createdAt: "2026-01-01T00:00:00.000Z",
        autonomyMode: "supervised",
      },
    ]);

    handle.unregisterSession("serve-b");

    expect(handle.listSessions("scope-b")).toEqual([]);
    expect(unregistered).toEqual([
      {
        id: "serve-b",
        scopeId: "scope-b",
      },
    ]);

    expect(handle.setActiveScopeId("scope-b"))
      .toEqual({ ok: true, activeScopeId: "scope-b" });
    scopeBHostingState = "draining";
    expect(handle.getActiveScopeId()).toBeNull();
    expect(handle.setActiveScopeId("scope-b"))
      .toEqual({
        ok: false,
        reason: "not_hosted",
        scopeId: "scope-b",
        state: "draining",
      });
    expect(
      handle.registerSession(
        "late-serve-b",
        "2026-01-01T00:01:00.000Z",
        "supervised",
        "scope-b",
      ),
    ).toEqual({
      ok: false,
      reason: "scope_not_hosted",
      scopeId: "scope-b",
      state: "draining",
    });
    expect(handle.enqueuePendingRun("builder", undefined, "scope-b"))
      .toEqual({
        ok: false,
        error: "Scope scope-b is draining and cannot accept workflow runs",
        reason: "scope_not_hosted",
        scopeId: "scope-b",
        state: "draining",
      });
    expect(workflowRuntime.enqueuePendingRun).not.toHaveBeenCalled();
    expect(handle.listSessions("scope-b")).toEqual([]);
  });
});
