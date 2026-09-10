import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import type { DaemonControlHandle } from "#core/daemon/daemon-control-types.js";
import { handleTriggerWorkflow } from "#core/daemon/daemon-control-workflow.js";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import { buildDirectoryScope } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import type { ControlRouteRegistration } from "#core/modules/module-types.js";
import { createKotaClientTestDouble } from "#core/server/daemon-client-test-support.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { initializeControlFixtureRepo, waitForControlCondition } from "#core/workflow/testing/daemon-control-responsiveness.js";
import { createTestWorkflowRuntime } from "#core/workflow/testing/runtime-fixture.js";
import { WORKFLOW_DISPATCHER_PROVIDER_TYPE } from "#core/workflow/workflow-dispatcher-provider.js";
import { buildArchitectureGardenerCommand } from "#modules/architecture-gardener/cli-command.js";
import { architectureReviewRequested } from "#modules/architecture-gardener/events.js";
import { buildGardenerControlRoutes } from "#modules/architecture-gardener/routes.js";
import workflow, { ARCHITECTURE_GARDENER_RUN_ARTIFACT, agent } from "#modules/architecture-gardener/workflow.js";
import { autonomyIssueDecisionRequested } from "#modules/autonomy/autonomy-issue-events.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import { buildWorkflowDaemonHandler } from "#modules/workflow-ops/index.js";

// Socket availability is an external port. Resource allocation and ownership
// still execute in the production RunResourceAllocator.
vi.mock("node:net", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:net")>(),
  createServer: () => ({
    unref: () => {}, once: () => {},
    listen: (_options: unknown, ready: () => void) => ready(),
    close: (closed: () => void) => closed(),
  }),
}));

// Replace the HTTP socket and model ports; production handlers, module events,
// queue admission, agent contract and transactional settlement remain real.
function invoke(handler: ControlRouteRegistration["handler"], path: string, body: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const stream = new PassThrough();
    const req = Object.assign(stream, { url: path }) as unknown as IncomingMessage;
    let status = 200;
    const res = {
      setHeader: () => {},
      writeHead: (code: number) => { status = code; },
      end: (content: string) => resolve(new Response(content, { status })),
    } as unknown as ServerResponse;
    Promise.resolve(handler(req, res, {})).catch(reject);
    stream.end(body);
  });
}

it("admits scoped API/CLI requests, investigates once, and rejects unknown scopes through normal dispatch", async () => {
  const root = mkdtempSync(join(tmpdir(), "gardener-public-"));
  const other = join(root, "other");
  mkdirSync(other);
  initializeControlFixtureRepo(other);
  const scopes = [buildDirectoryScope({ scopeRoot: root }), buildDirectoryScope({ scopeRoot: other })];
  const scopeId = scopes[1]!.scopeId;
  const bus = new EventBus();
  const config = { defaultAgentHarness: "gardener-fixture" };
  const loader = new ModuleLoader(config);
  loader.setCwd(root);
  loader.setBus(bus);
  await loader.load({
    name: "gardener-public-fixture", events: [architectureReviewRequested, autonomyIssueDecisionRequested],
    agents: [agent], workflows: [{ ...workflow, moduleRoot: process.cwd() }], controlRoutes: buildGardenerControlRoutes,
  });
  let investigations = 0;
  const unregister = registerAgentHarness({
    name: "gardener-fixture", description: "Controlled model port", supportsMultiTurn: false,
    supportedHookKinds: [], askOwnerToolName: "ask_owner", emitsAgentMessageStream: true, toolControl: "kota",
    run: async (options) => {
      investigations++;
      expect(options.scopeRoot).toBe(other);
      expect(options.cwd).not.toBe(other);
      expect(options.agentWriteScope).toBe("deny-all");
      expect(options.prompt).toContain("inspect-evidence");
      const decision = { action: "no-action", rationale: "The selected scope has no implementations to consolidate.", evidenceRefs: ["src/ (absent in selected scope)"], existingTaskId: null, proposal: null };
      const text = `\`\`\`json\n${JSON.stringify(decision)}\n\`\`\``;
      return { text, streamedText: text, turns: 1, isError: false,
        usage: { tokens: { state: "unknown" }, cost: { state: "unknown" } } };
    },
  });
  const host = createTestWorkflowRuntime({ bus, scopeRoot: other, scopeId, workflows: loader.getContributedWorkflows(),
    resolveAgentDef: (name) => loader.getAgentDef(name), config, idleIntervalMs: 60_000 });
  const projection = { rootScopeId: "global", defaultScopeId: scopes[0]!.scopeId,
    scopes: scopes.map((scope) => ({ scopeId: scope.scopeId, displayName: scope.displayName, directoryRoot: scope.scopeRoot, parentScopeId: "global" })) };
  loader.getProviderRegistry().register(DAEMON_SCOPE_PROVIDER_TYPE, "fixture", {
    getScopeRegistryProjection: () => projection, getActiveScopeId: () => null,
    resolveScopeRuntime: () => { throw new Error("Unexpected scope runtime lookup"); },
  });
  loader.getProviderRegistry().register(WORKFLOW_DISPATCHER_PROVIDER_TYPE, "fixture", {
    execute: (request) => host.runtime.execute(request),
    enqueuePendingRun: async (name) => (await host.runtime.enqueuePendingRun(name)),
    enqueueWebhookRun: (name, payload) => host.runtime.enqueueWebhookRun(name, payload),
  });
  const handle = {
    hasScope: (selected: string) => selected === scopeId,
    getActiveScopeId: () => null, getScopeRegistryProjection: () => projection,
    enqueuePendingRun: async (name, options, selected) => {
      expect(selected).toBe(scopeId);
      return (await host.runtime.enqueuePendingRun(name, options));
    },
  } satisfies Pick<DaemonControlHandle, "hasScope" | "getActiveScopeId" | "getScopeRegistryProjection" | "enqueuePendingRun">;
  const link = {
    fetchRaw: (path: string, init: { body?: unknown }) => invoke(
      (req, res) => handleTriggerWorkflow(handle as DaemonControlHandle, req, res, new URL(path, "http://localhost")), path, String(init.body)),
  } as DaemonTransport;
  const client = createKotaClientTestDouble({ workflow: buildWorkflowDaemonHandler(link),
    scopes: { list: async () => ({ ok: true, scopes, defaultScopeId: scopes[0]!.scopeId, activeScopeId: null }) } });
  try {
    host.runtime.start();
    const route = loader.getContributedControlRoutes().find((route) => route.path === "/api/architecture/review")!;
    const response = await invoke(route.handler, `/api/architecture/review?scopeId=${scopeId}`, JSON.stringify({ targetScope: "repo" }));
    expect(response.status).toBe(202);
    await waitForControlCondition(() => {
      const failed = host.runState.listRuns(scopeId, ["failed", "needs_attention"]);
      if (failed.length) throw new Error(JSON.stringify(failed));
      return host.runState.listRuns(scopeId, ["succeeded"]).length === 1;
    }, 15_000);
    expect(investigations).toBe(1);
    const first = host.runState.listRuns(scopeId, ["succeeded"])[0]!;
    const artifact = JSON.parse(readFileSync(join(other, ".kota/runs", first.id, ARCHITECTURE_GARDENER_RUN_ARTIFACT), "utf8"));
    expect(artifact.decision.action).toBe("no-action");
    expect(artifact.observations).toEqual([]);
    const command = buildArchitectureGardenerCommand({ cwd: root, client });
    await command.parseAsync(["review", "repo", "--scope", scopeId, "--json"], { from: "user" });
    await waitForControlCondition(() => host.runState.listRuns(scopeId, ["succeeded"]).length === 2, 15_000);
    expect(investigations).toBe(1);
    expect(listFullRepoTasks(other)).toEqual([]);
    expect((await invoke(route.handler, "/api/architecture/review?scopeId=missing", "{}")).status).toBe(404);
    expect((await invoke(route.handler, `/api/architecture/review?scopeId=${scopeId}`, '{"targetScope":3}')).status).toBe(400);
  } finally {
    await host.stop();
    unregister();
    await loader.unloadAll();
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
