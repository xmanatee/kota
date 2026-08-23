/**
 * Integration test: the daemon must drive a full module-load lifecycle
 * before serving provider-backed routes. The CLI bootstraps its
 * `ModuleLoader` in `"commands"` mode for cheap subcommand registration,
 * which intentionally skips every module's `onLoad` — including the
 * `registerProvider` calls that back `/api/knowledge`, `/api/memory`,
 * `/api/history`, `/recall`, `/answer`, etc.
 *
 * Failure mode this test pins down:
 *   `pnpm build && node dist/cli.js daemon` produced a daemon whose
 *   `/status` looked healthy while every provider-backed route returned a
 *   500 with "provider not registered". The runtime now uses
 *   `loadRuntimeModules` so the lifecycle and the served routes cannot
 *   diverge.
 *
 * This test proves `loadRuntimeModules` registers provider-backed seams and a
 * daemon built from its contributions serves `/api/knowledge` with 200.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Daemon } from "#core/daemon/daemon.js";
import type { DaemonControlAddress } from "#core/daemon/daemon-control.js";
import { DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE } from "#core/daemon/runtime-scope-provider.js";
import { resetScheduler } from "#core/daemon/scheduler.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus, initEventBus, resetEventBus } from "#core/events/event-bus.js";
import { EventJournal } from "#core/events/event-journal.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import {
  getKnowledgeProvider,
  getProviderRegistry,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { loadRuntimeModules } from "#core/modules/runtime-loader.js";
import { autonomyIssueDecisionRequested } from "#modules/autonomy/autonomy-issue-events.js";
import { readAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.js";
import {
  type AutonomyHealthSignal,
  autonomyHealthSignal,
} from "#modules/autonomy/health-signal.js";

function readControlAddress(stateDir: string): DaemonControlAddress {
  const raw = readFileSync(join(stateDir, "daemon-control.json"), "utf-8");
  return JSON.parse(raw) as DaemonControlAddress;
}

async function fetchWithToken(
  port: number,
  path: string,
  token: string,
): Promise<Response> {
  return globalThis.fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("daemon runtime module load", () => {
  let rootDir: string;
  let projectDir: string;
  let stateDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "kota-runtime-load-"));
    projectDir = join(rootDir, "project-a");
    stateDir = join(projectDir, ".kota");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    resetEventBus();
    resetScheduler();
    resetProviderRegistry();
  });

  afterEach(() => {
    resetEventBus();
    resetScheduler();
    resetProviderRegistry();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("rejects a daemon host whose loader is bound to a different event authority", () => {
    const loaderBus = new EventBus();
    const loader = new ModuleLoader({}, false, { mode: "runtime" });
    loader.setBus(loaderBus);

    expect(() => new Daemon({
      runtimeModuleHost: { eventBus: new EventBus(), moduleLoader: loader },
      projectDir,
      stateDir,
    })).toThrow(/bound to a different EventBus authority/);
  });

  it("loadRuntimeModules binds provider routes and live failure traffic across restart", async () => {
    const config = {
      defaultAgentHarness: "claude-agent-sdk",
      model: "ollama/gpt-5.6-sol",
    };
    const eventBus = initEventBus();
    const loader = await loadRuntimeModules({
      config,
      cwd: projectDir,
      eventBus,
    });
    const sourceListenerCount = eventBus.listenerCount("workflow.failure.alert");
    const scopeId = deriveDirectoryScopeId(projectDir);
    const initialHealthSignals: Array<AutonomyHealthSignal & {
      scopeId: string;
      projectId: string;
    }> = [];
    const stopInitialHealthObservation = eventBus.on(
      autonomyHealthSignal,
      (payload) => initialHealthSignals.push(payload),
    );

    expect(() => getKnowledgeProvider()).not.toThrow();
    expect(sourceListenerCount).toBeGreaterThan(0);

    const daemon = new Daemon({
      runtimeModuleHost: { eventBus, moduleLoader: loader },
      projectDir,
      stateDir,
      idleIntervalMs: 60_000,
      pollIntervalMs: 60_000,
      workflows: [],
      channels: [],
      controlRoutes: loader.getContributedControlRoutes(),
      routes: loader.getRoutes(),
      config,
      unloadModules: () => loader.unloadAll(),
    });

    const startPromise = daemon.start();
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      const address = readControlAddress(stateDir);
      const res = await fetchWithToken(
        address.port,
        "/api/knowledge",
        address.token!,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { entries: unknown[] };
      expect(Array.isArray(body.entries)).toBe(true);
      new ProjectScopedEventBus(eventBus, scopeId).emit("workflow.failure.alert", {
        workflow: "builder",
        runId: "daemon-runtime-cold-start-event-run",
        status: "failed",
        durationMs: 1000,
        errorSummary: "daemon cold-start integration failure",
        text: "builder failed after cold start",
      });
      expect(initialHealthSignals).toEqual([
        expect.objectContaining({
          scopeId,
          projectId: scopeId,
          source: expect.objectContaining({ id: "builder" }),
        }),
      ]);
    } finally {
      stopInitialHealthObservation();
      await daemon.stop();
      await startPromise;
    }
    expect(eventBus.listenerCount("workflow.failure.alert")).toBe(0);

    const restartedLoader = await loadRuntimeModules({
      config,
      cwd: projectDir,
      eventBus,
    });
    const restartedSourceListenerCount = eventBus.listenerCount("workflow.failure.alert");
    const reviewerWorkflow = restartedLoader.getContributedWorkflows().find(
      (workflow) => workflow.name === "autonomy-health-reviewer",
    );
    expect(restartedSourceListenerCount).toBe(sourceListenerCount);
    expect(reviewerWorkflow).toBeDefined();

    const healthSignals: Array<AutonomyHealthSignal & {
      scopeId: string;
      projectId: string;
    }> = [];
    const decisions: Array<{ scopeId: string; projectId: string; issueKey: string }> = [];
    eventBus.on(autonomyHealthSignal, (payload) => healthSignals.push(payload));
    const restartedDaemon = new Daemon({
      runtimeModuleHost: { eventBus, moduleLoader: restartedLoader },
      projectDir,
      stateDir,
      idleIntervalMs: 60_000,
      pollIntervalMs: 60_000,
      // Keep the restarted fixture bounded to the workflow that consumes the
      // source-owned health event and projects its durable decision handoff.
      workflows: [reviewerWorkflow!],
      channels: [],
      controlRoutes: restartedLoader.getContributedControlRoutes(),
      routes: restartedLoader.getRoutes(),
      config,
      unloadModules: () => restartedLoader.unloadAll(),
    });

    const restartedStartPromise = restartedDaemon.start();
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      const address = readControlAddress(stateDir);
      const createSessionResponse = await globalThis.fetch(
        `http://127.0.0.1:${address.port}/sessions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${address.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ autonomy_mode: "supervised" }),
        },
      );
      const createSessionDiagnostic = await createSessionResponse.clone().text();
      expect(createSessionResponse.status, createSessionDiagnostic).toBe(201);
      const createdSession = await createSessionResponse.json() as {
        session_id: string;
      };
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(eventBus.listenerCount("workflow.failure.alert")).toBe(
        restartedSourceListenerCount,
      );
      const runtimeScopeProvider = getProviderRegistry()?.get(
        DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE,
      );
      expect(runtimeScopeProvider?.resolve(scopeId)).toEqual(
        expect.objectContaining({ ok: true }),
      );
      const decisionObserved = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("timed out waiting for scoped autonomy issue decision")),
          3000,
        );
        eventBus.on(autonomyIssueDecisionRequested, (payload) => {
          decisions.push(payload);
          clearTimeout(timeout);
          resolve();
        });
      });
      new ProjectScopedEventBus(eventBus, scopeId).emit("workflow.failure.alert", {
        workflow: "builder",
        runId: "daemon-runtime-event-run",
        status: "failed",
        durationMs: 1000,
        errorSummary: "daemon runtime integration failure",
        text: "builder failed",
      });
      expect(healthSignals).toEqual([
        expect.objectContaining({
          scopeId,
          projectId: scopeId,
          source: expect.objectContaining({ id: "builder" }),
        }),
      ]);
      await decisionObserved;
      expect(decisions).toEqual([
        expect.objectContaining({ scopeId, projectId: scopeId }),
      ]);
      expect(readAutonomyIssueProjection(projectDir).issues).toEqual([
        expect.objectContaining({
          status: "needs-decision",
          source: expect.objectContaining({ id: "builder" }),
        }),
      ]);
      const journal = new EventJournal(join(stateDir, "events"));
      expect(journal.query({ type: autonomyHealthSignal.name, scopeId })).toHaveLength(2);
      expect(journal.query({ type: autonomyIssueDecisionRequested.name, scopeId })).toHaveLength(1);
      const deleteSessionResponse = await globalThis.fetch(
        `http://127.0.0.1:${address.port}/sessions/${createdSession.session_id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${address.token}` },
        },
      );
      expect(deleteSessionResponse.status).toBe(204);
      expect(eventBus.listenerCount("workflow.failure.alert")).toBe(
        restartedSourceListenerCount,
      );
      expect(getProviderRegistry()?.get(DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE)).toBe(
        runtimeScopeProvider,
      );
    } finally {
      await restartedDaemon.stop();
      await restartedStartPromise;
    }
    expect(eventBus.listenerCount("workflow.failure.alert")).toBe(0);
  });
});
