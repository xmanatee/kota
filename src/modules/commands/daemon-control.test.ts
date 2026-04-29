/**
 * Exercises the commands module's daemon-control routes through the same
 * registration seam the real daemon uses: `commandsControlRoutes()` is the
 * module's contribution, so the test mounts those handlers on a live
 * `DaemonControlServer` and hits `GET /commands` and `POST /commands/invoke`
 * via HTTP.
 *
 * Covers the wire contract migrated out of core: bearer-token auth, the
 * `read` / `control` capability-scope split (the GET is read-only, the POST
 * requires control), `{ commands: SlashCommand[] }` envelope on list,
 * `{ kind: "skill", prompt }` and `{ kind: "workflow", queued, runId }`
 * envelopes on invoke, `400 { error: "Invalid JSON body" }` on parse failure,
 * `400 { error: "name must be a non-empty string" }` on missing name,
 * `404 { error: 'Command "<name>" not found' }` on unknown command,
 * `409 { error: 'Workflow "<name>" is already queued' }` on already-queued,
 * and `503` when either the catalog or workflow-dispatcher seams are
 * unavailable. Workflow invocation is covered end-to-end by registering a
 * stub `WorkflowDispatcher` against the provider registry, mirroring how the
 * daemon registers its own dispatcher at startup.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  type DaemonControlHandle,
  DaemonControlServer,
  type WorkflowMetricCounts,
} from "#core/daemon/daemon-control.js";
import {
  getProviderRegistry,
  initProviderRegistry,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { SLASH_COMMAND_PROVIDER_TYPE } from "#core/modules/slash-command-provider.js";
import {
  type EnqueuePendingRunResult,
  WORKFLOW_DISPATCHER_PROVIDER_TYPE,
  type WorkflowDispatcher,
} from "#core/workflow/workflow-dispatcher-provider.js";
import { buildSlashCommandCatalog } from "./catalog.js";
import { commandsControlRoutes } from "./control-routes.js";

const TEST_TOKEN = "commands-test-token";

function makeHandle(): DaemonControlHandle {
  return {
    getDaemonLiveState: vi.fn(() => ({
      startedAt: "2026-01-01T00:00:00.000Z",
      completedRuns: 0,
      pid: 1,
      running: true,
    })),
    getHealthStatus: vi.fn(() => ({
      scheduler: "ok" as const,
      modules: "ok" as const,
    })),
    getWorkflowLiveStatus: vi.fn(() => ({
      activeRuns: [],
      pendingRuns: [],
      queueLength: 0,
      completedRuns: 0,
      workflows: {},
      paused: false,
      agentConcurrency: 1,
      codeConcurrency: 4,
    })),
    pauseWorkflowDispatch: vi.fn(() => ({ already: false })),
    resumeWorkflowDispatch: vi.fn(() => ({ already: false })),
    abortActiveRuns: vi.fn(() => ({ aborted: 0 })),
    abortActiveRun: vi.fn(() => ({ ok: false, notFound: true })),
    reloadWorkflowDefinitions: vi.fn(() => ({ count: 0 })),
    getWorkflowDefinitions: vi.fn(() => []),
    enableWorkflow: vi.fn(() => ({ ok: true })),
    disableWorkflow: vi.fn(() => ({ ok: true })),
    enqueuePendingRun: vi.fn(() => ({ ok: true })),
    cancelQueuedRun: vi.fn(() => ({ ok: false, notFound: true })),
    subscribeToEvents: vi.fn(() => () => {}),
    listWorkflowRuns: vi.fn(() => []),
    getWorkflowRun: vi.fn(() => null),
    getWorkflowMetricCounts: vi.fn((): WorkflowMetricCounts => ({
      runCounts: [],
      costTotals: [],
      durationHistogram: [],
    })),
    registerSession: vi.fn(),
    unregisterSession: vi.fn(),
    listSessions: vi.fn(() => []),
    setSessionAutonomyMode: vi.fn(() => ({ ok: false, notFound: true })),
    reloadConfig: vi.fn(async () => ({ workflows: 0, changedModules: [] })),
    probeCapabilityReadiness: vi.fn(async () => ({ capabilities: [], summary: { ready: 0, unavailable: 0, init_failed: 0 } })),
    getClientIdentity: vi.fn(async () => ({
      projectName: "test-project",
      projectDir: "/tmp/test-project",
      daemonVersion: "0.1.0",
      pid: 9999,
      startedAt: "2026-01-01T00:00:00.000Z",
      dashboard: {
        available: false as const,
        reason: "not_contributed",
        message: "No module contributed a dashboard capability.",
      },
    })),
  };
}

async function fetchWith(
  port: number,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return globalThis.fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TEST_TOKEN}`, ...init.headers },
  });
}

type CatalogScenario = {
  /** Workflow definitions visible to the catalog. */
  workflows?: Array<{
    name: string;
    description?: string;
    tags?: string[];
    contributingModule?: string;
  }>;
  /** Skills exposed by module summaries. */
  skills?: Array<{ name: string; description?: string; promptPath: string; module: string }>;
};

function registerCatalog(projectDir: string, scenario: CatalogScenario): void {
  const registry = getProviderRegistry();
  if (!registry) throw new Error("provider registry not initialized");
  const summaries = (scenario.skills ?? []).reduce<
    Array<{ name: string; skills: Array<{ name: string; description?: string; promptPath: string }> }>
  >((acc, s) => {
    let entry = acc.find((m) => m.name === s.module);
    if (!entry) {
      entry = { name: s.module, skills: [] };
      acc.push(entry);
    }
    entry.skills.push({
      name: s.name,
      description: s.description,
      promptPath: s.promptPath,
    });
    return acc;
  }, []);
  const catalog = buildSlashCommandCatalog({
    getContributedWorkflows: () =>
      (scenario.workflows ?? []).map((w) => ({
        name: w.name,
        description: w.description,
        tags: w.tags,
        contributingModule: w.contributingModule,
        steps: [],
        triggers: [],
      } as never)),
    getModuleSummaries: () =>
      summaries.map((s) => ({
        name: s.name,
        source: "project" as const,
        dependencies: [],
        toolNames: [],
        workflowNames: [],
        channelNames: [],
        skillNames: s.skills.map((sk) => sk.name),
        agentNames: [],
        agents: [],
        skills: s.skills,
        commandNames: [],
        routeSummaries: [],
      } as never)),
    projectDir,
  });
  registry.register(SLASH_COMMAND_PROVIDER_TYPE, "commands-test", catalog);
}

function registerDispatcher(
  result: EnqueuePendingRunResult | (() => EnqueuePendingRunResult),
): Mock<(name: string) => EnqueuePendingRunResult> {
  const fn = vi.fn((_name: string) => (typeof result === "function" ? result() : result));
  const dispatcher: WorkflowDispatcher = {
    enqueuePendingRun: fn,
    enqueueWebhookRun: vi.fn(() => ({ ok: false, notFound: true })),
  };
  const registry = getProviderRegistry();
  if (!registry) throw new Error("provider registry not initialized");
  registry.register(WORKFLOW_DISPATCHER_PROVIDER_TYPE, "test", dispatcher);
  return fn;
}

describe("commands module daemon-control routes", () => {
  let server: DaemonControlServer;
  let port: number;
  let projectDir: string;

  beforeEach(async () => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-commands-control-"));
    resetProviderRegistry();
    initProviderRegistry();
    server = new DaemonControlServer(makeHandle(), TEST_TOKEN, {
      controlRoutes: commandsControlRoutes(),
    });
    port = await server.start();
  });

  afterEach(async () => {
    await server.stop();
    resetProviderRegistry();
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe("registration seam", () => {
    it("declares /commands routes with read/control capability scopes", () => {
      const routes = commandsControlRoutes();
      expect(routes.map((r) => `${r.method} ${r.path} (${r.capabilityScope})`)).toEqual([
        "GET /commands (read)",
        "POST /commands/invoke (control)",
      ]);
    });

    it("requires the daemon bearer token on both routes", async () => {
      registerCatalog(projectDir, {});
      const list = await globalThis.fetch(`http://127.0.0.1:${port}/commands`);
      expect(list.status).toBe(401);
      const invoke = await globalThis.fetch(
        `http://127.0.0.1:${port}/commands/invoke`,
        { method: "POST" },
      );
      expect(invoke.status).toBe(401);
    });
  });

  describe("GET /commands", () => {
    it("returns 503 when no catalog is registered", async () => {
      const res = await fetchWith(port, "/commands");
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "Slash-command catalog unavailable" });
    });

    it("returns the catalog list when registered", async () => {
      registerCatalog(projectDir, {
        workflows: [
          { name: "builder", description: "Run the builder", tags: ["command"], contributingModule: "autonomy" },
          { name: "internal", tags: [], contributingModule: "autonomy" },
        ],
      });

      const res = await fetchWith(port, "/commands");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { commands: Array<{ name: string; source: string }> };
      expect(body.commands.map((c) => c.name)).toEqual(["builder"]);
      expect(body.commands[0]).toMatchObject({
        name: "builder",
        label: "/builder",
        description: "Run the builder",
        source: "workflow",
        module: "autonomy",
      });
    });
  });

  describe("POST /commands/invoke", () => {
    it("returns 503 when no catalog is registered", async () => {
      const res = await fetchWith(port, "/commands/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "builder" }),
      });
      expect(res.status).toBe(503);
    });

    it("returns 400 for invalid JSON body", async () => {
      registerCatalog(projectDir, {});
      const res = await fetchWith(port, "/commands/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid JSON body" });
    });

    it("returns 400 when name is missing or empty", async () => {
      registerCatalog(projectDir, {});
      for (const body of [{}, { name: "" }, { name: 123 }]) {
        const res = await fetchWith(port, "/commands/invoke", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
          error: "name must be a non-empty string",
        });
      }
    });

    it("returns 404 when the command is unknown", async () => {
      registerCatalog(projectDir, {});
      const res = await fetchWith(port, "/commands/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "missing" }),
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Command "missing" not found' });
    });

    it("returns 200 with the skill prompt for a skill command", async () => {
      const promptPath = join(projectDir, "deep-research.md");
      writeFileSync(promptPath, "Investigate carefully.\n");
      registerCatalog(projectDir, {
        skills: [
          { name: "deep-research", description: "Research", promptPath, module: "research" },
        ],
      });

      const res = await fetchWith(port, "/commands/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "skill:deep-research" }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        kind: "skill",
        prompt: "Investigate carefully.",
      });
    });

    it("returns 200 with queued workflow and runId when the dispatcher accepts", async () => {
      registerCatalog(projectDir, {
        workflows: [
          { name: "builder", tags: ["command"], contributingModule: "autonomy" },
        ],
      });
      const dispatch = registerDispatcher({
        ok: true,
        queued: "builder",
        runId: "2026-01-01T00-00-00-000Z-builder-abc123",
      });

      const res = await fetchWith(port, "/commands/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "builder" }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        kind: "workflow",
        queued: "builder",
        runId: "2026-01-01T00-00-00-000Z-builder-abc123",
      });
      expect(dispatch).toHaveBeenCalledWith("builder");
    });

    it("returns 409 when the dispatcher reports the workflow is already queued", async () => {
      registerCatalog(projectDir, {
        workflows: [
          { name: "builder", tags: ["command"], contributingModule: "autonomy" },
        ],
      });
      registerDispatcher({ ok: false, alreadyQueued: true });

      const res = await fetchWith(port, "/commands/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "builder" }),
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: 'Workflow "builder" is already queued',
      });
    });

    it("returns 400 when the dispatcher reports a generic enqueue failure", async () => {
      registerCatalog(projectDir, {
        workflows: [
          { name: "builder", tags: ["command"], contributingModule: "autonomy" },
        ],
      });
      registerDispatcher({ ok: false, error: "Workflow disabled" });

      const res = await fetchWith(port, "/commands/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "builder" }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Workflow disabled" });
    });

    it("returns 503 when the workflow-dispatcher seam is not registered", async () => {
      registerCatalog(projectDir, {
        workflows: [
          { name: "builder", tags: ["command"], contributingModule: "autonomy" },
        ],
      });
      // Catalog registered, but no dispatcher.
      const res = await fetchWith(port, "/commands/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "builder" }),
      });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: "Workflow dispatcher unavailable",
      });
    });
  });

  describe("collision detection", () => {
    it("throws at server construction if two contributions claim the same route key", () => {
      const collision = [
        ...commandsControlRoutes(),
        {
          method: "GET" as const,
          path: "/commands",
          capabilityScope: "read" as const,
          handler: (_req: unknown, res: { writeHead: (s: number) => void; end: () => void }) => {
            res.writeHead(500);
            res.end();
          },
        },
      ];
      expect(
        () =>
          new DaemonControlServer(makeHandle(), TEST_TOKEN, {
            controlRoutes: collision as never,
          }),
      ).toThrow(/collides/);
    });
  });
});
