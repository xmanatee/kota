import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelDef } from "#core/channels/channel.js";
import { Daemon } from "#core/daemon/daemon.js";
import type { DaemonControlAddress } from "#core/daemon/daemon-control.js";
import type { ProjectRuntime } from "#core/daemon/project-runtime.js";
import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
import { resetScheduler, Scheduler } from "#core/daemon/scheduler.js";
import {
  buildConfiguredProject,
  type ConfiguredProject,
} from "#core/daemon/scope-registry.js";
import { EventBus, getEventBus, resetEventBus } from "#core/events/event-bus.js";
import type { LoopOptions } from "#core/loop/loop.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import {
  getProviderRegistry,
  initProviderRegistry,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import { daemonTransportFromAddress } from "#core/server/daemon-transport.js";
import type { KotaClient } from "#core/server/kota-client.js";
import { createProjectScopedKotaClient } from "#core/server/project-scoped-kota-client.js";
import type { CaptureClient } from "#modules/capture/client.js";
import type { MemoryClient } from "#modules/memory/client.js";
import type { RetractClient } from "#modules/retract/client.js";
import { TelegramBot } from "./bot.js";
import { callTelegramApi } from "./client.js";
import telegramModule from "./index.js";
import { TelegramProjectSelection } from "./project-selection.js";
import { startTelegramStatusPoll } from "./status-poll.js";

vi.mock("./client.js", async () => {
  const actual =
    await vi.importActual<typeof import("./client.js")>("./client.js");
  return { ...actual, callTelegramApi: vi.fn() };
});

vi.mock("./callback-poll.js", () => ({
  startCallbackPoll: vi.fn(() => () => {}),
}));

const agentSendMock = vi.fn(async () => undefined);
const agentCloseMock = vi.fn();
const agentSessionOptions: LoopOptions[] = [];

vi.mock("#core/loop/loop.js", async () => {
  const actual = await vi.importActual<typeof import("#core/loop/loop.js")>(
    "#core/loop/loop.js",
  );
  class FakeAgentSession {
    constructor(options?: LoopOptions) {
      if (options) agentSessionOptions.push(options);
    }
    send = agentSendMock;
    close = agentCloseMock;
    getCostSummary = vi.fn().mockReturnValue("$0.00");
    get isClosed(): boolean {
      return false;
    }
  }
  return {
    ...actual,
    AgentSession: FakeAgentSession as unknown as typeof actual.AgentSession,
  };
});

const mockedCallTelegramApi = vi.mocked(callTelegramApi);

const PROJECT_A: ConfiguredProject = {
  projectId: "project-a",
  projectDir: "/tmp/project-a",
  displayName: "Project A",
};
const PROJECT_B: ConfiguredProject = {
  projectId: "project-b",
  projectDir: "/tmp/project-b",
  displayName: "Project B",
};

function makeProjectRuntime(project: ConfiguredProject): ProjectRuntime {
  return {
    project,
    scheduler: new Scheduler(project.projectDir, null),
  } as ProjectRuntime;
}

function readControlAddress(stateDir: string): DaemonControlAddress {
  return JSON.parse(
    readFileSync(join(stateDir, "daemon-control.json"), "utf-8"),
  ) as DaemonControlAddress;
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
    });
    req.on("error", reject);
  });
}

type RoutedCall = {
  kind: "memory" | "capture" | "retract";
  projectId: string;
  query?: string;
  text?: string;
  id?: string;
};

function makeProjectScopedRoutes(
  calls: RoutedCall[],
  defaultProject: ConfiguredProject = PROJECT_A,
) {
  return [
    {
      method: "GET" as const,
      path: "/api/memory/search",
      handler(req: IncomingMessage, res: ServerResponse) {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const projectId = url.searchParams.get("projectId") ?? defaultProject.projectId;
        const query = url.searchParams.get("q") ?? "";
        calls.push({ kind: "memory", projectId, query });
        const entries =
          projectId === defaultProject.projectId && query.includes("alpha")
            ? [
                {
                  id: "mem-a",
                  created: "2026-05-14T00:00:00.000Z",
                  content: "alpha lives only in project A",
                },
              ]
            : [];
        writeJson(res, 200, { ok: true, entries });
      },
    },
    {
      method: "POST" as const,
      path: "/capture",
      async handler(req: IncomingMessage, res: ServerResponse) {
        const body = await readJsonBody(req);
        const filter = body.filter as { projectId?: string; target?: "memory" } | undefined;
        const projectId = filter?.projectId ?? defaultProject.projectId;
        calls.push({
          kind: "capture",
          projectId,
          text: typeof body.text === "string" ? body.text : "",
        });
        writeJson(res, 200, {
          ok: true,
          record: { target: "memory", recordId: `${projectId}-capture` },
        });
      },
    },
    {
      method: "POST" as const,
      path: "/retract",
      async handler(req: IncomingMessage, res: ServerResponse) {
        const body = await readJsonBody(req);
        const projectId = typeof body.projectId === "string" ? body.projectId : defaultProject.projectId;
        calls.push({
          kind: "retract",
          projectId,
          id: typeof body.id === "string" ? body.id : "",
        });
        writeJson(res, 200, {
          ok: true,
          record: { target: "memory", recordId: typeof body.id === "string" ? body.id : "unknown" },
        });
      },
    },
  ];
}

function buildDaemonProjectClient(
  address: DaemonControlAddress,
): KotaClient {
  const transport = daemonTransportFromAddress(address);
  const stubs = buildMigratedNamespaceTestStubs();
  let client: KotaClient;
  client = {
    ...stubs,
    forProject: (projectId: string) =>
      createProjectScopedKotaClient(client, projectId),
    projects: {
      list: async () => {
        const raw = await transport.requestStrict<{
          projects: ConfiguredProject[];
          defaultProjectId: string;
          activeProjectId: string | null;
        }>("GET", "/projects");
        return { ok: true as const, ...raw };
      },
      use: async (projectId: string | null) => {
        const raw = await transport.requestStrict<{ activeProjectId: string | null }>(
          "PATCH",
          "/projects/active",
          { projectId },
        );
        return { ok: true as const, activeProjectId: raw.activeProjectId };
      },
    },
    memory: {
      ...stubs.memory!,
      search: async (query, filter) => {
        const params = new URLSearchParams();
        params.set("q", query);
        if (filter?.semantic) params.set("semantic", "true");
        if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
        if (filter?.projectId) params.set("projectId", filter.projectId);
        return transport.requestStrict(
          "GET",
          `/api/memory/search?${params.toString()}`,
        ) as ReturnType<KotaClient["memory"]["search"]>;
      },
    },
    capture: {
      capture: async (text, filter) =>
        transport.requestStrict("POST", "/capture", {
          text,
          ...(filter ? { filter } : {}),
        }) as ReturnType<KotaClient["capture"]["capture"]>,
    },
    retract: {
      retract: async (request) =>
        transport.requestStrict(
          "POST",
          "/retract",
          request,
        ) as ReturnType<KotaClient["retract"]["retract"]>,
    },
  } as KotaClient;
  return client;
}

type ProjectSpies = {
  workflowStatus: ReturnType<typeof vi.fn<KotaClient["workflow"]["status"]>>;
  memorySearch: ReturnType<typeof vi.fn<MemoryClient["search"]>>;
  capture: ReturnType<typeof vi.fn<CaptureClient["capture"]>>;
  retract: ReturnType<typeof vi.fn<RetractClient["retract"]>>;
};

function makeProjectClient(project: ConfiguredProject, spies: ProjectSpies): KotaClient {
  return {
    forProject: vi.fn(() => makeProjectClient(project, spies)),
    workflow: {
      status: spies.workflowStatus,
    },
    memory: {
      list: vi.fn(async () => ({ entries: [] })),
      add: vi.fn(async () => ({ id: `${project.projectId}-memory` })),
      delete: vi.fn(async () => ({ ok: true as const })),
      search: spies.memorySearch,
      reindex: vi.fn(async () => ({ indexed: 0, failed: 0 })),
    },
    capture: { capture: spies.capture },
    retract: { retract: spies.retract },
  } as unknown as KotaClient;
}

function makeClient(
  spiesByProject: Map<string, ProjectSpies>,
  projectsListResult?: Awaited<ReturnType<KotaClient["projects"]["list"]>>,
): KotaClient {
  const projectClients = new Map<string, KotaClient>();
  for (const project of [PROJECT_A, PROJECT_B]) {
    projectClients.set(project.projectId, makeProjectClient(project, spiesByProject.get(project.projectId)!));
  }
  const listResult = projectsListResult ?? {
    ok: true as const,
    defaultProjectId: PROJECT_A.projectId,
    activeProjectId: null,
    projects: [PROJECT_A, PROJECT_B],
  };
  return {
    forProject: vi.fn((projectId: string) => {
      const client = projectClients.get(projectId);
      if (!client) throw new Error(`Unknown project: ${projectId}`);
      return client;
    }),
    projects: {
      list: vi.fn(async () => listResult),
      use: vi.fn(),
    },
  } as unknown as KotaClient;
}

function makeSpies(): Map<string, ProjectSpies> {
  return new Map([
    [
      PROJECT_A.projectId,
      {
        workflowStatus: vi.fn(async () => ({
          activeRuns: [],
          pendingRuns: [],
          queueLength: 0,
          completedRuns: 0,
          workflows: {},
          paused: false,
          pendingAbort: false,
          agentConcurrency: 1,
          codeConcurrency: 4,
        })),
        memorySearch: vi.fn(async () => ({
          ok: true as const,
          entries: [
            {
              id: "mem-a",
              created: "2026-05-14T00:00:00.000Z",
              content: "alpha lives only in project A",
            },
          ],
        })),
        capture: vi.fn(async () => ({
          ok: true as const,
          record: { target: "memory" as const, recordId: "capture-a" },
        })),
        retract: vi.fn(async () => ({
          ok: true as const,
          record: { target: "memory" as const, recordId: "retract-a" },
        })),
      },
    ],
    [
      PROJECT_B.projectId,
      {
        workflowStatus: vi.fn(async () => ({
          activeRuns: [],
          pendingRuns: [],
          queueLength: 0,
          completedRuns: 0,
          workflows: {},
          paused: true,
          pendingAbort: false,
          agentConcurrency: 1,
          codeConcurrency: 4,
        })),
        memorySearch: vi.fn(async () => ({ ok: true as const, entries: [] })),
        capture: vi.fn(async () => ({
          ok: true as const,
          record: { target: "memory" as const, recordId: "capture-b" },
        })),
        retract: vi.fn(async () => ({
          ok: true as const,
          record: { target: "memory" as const, recordId: "mem-b" },
        })),
      },
    ],
  ]);
}

function makeStatusInfo() {
  return {
    runtimeState: {
      completedRuns: 0,
      pendingRuns: [],
      workflows: {},
    },
    dispatchPaused: false,
    runsDir: "/tmp/project-a/.kota/runs",
  };
}

function registerDaemonProjectScopeProvider(
  projects: ConfiguredProject[] = [PROJECT_A, PROJECT_B],
  defaultProject: ConfiguredProject = PROJECT_A,
): void {
  const registry = getProviderRegistry() ?? initProviderRegistry();
  registry.register(DAEMON_PROJECT_SCOPE_PROVIDER_TYPE, "test", {
    getProjectRegistryProjection: () => ({
      defaultProjectId: defaultProject.projectId,
      projects,
    }),
    getActiveProjectId: () => null,
    resolveProjectRuntime: (projectId) => {
      const requested = projectId?.trim();
      const resolvedProjectId =
        requested && requested.length > 0
          ? requested
          : defaultProject.projectId;
      const project = projects.find((entry) => entry.projectId === resolvedProjectId);
      if (!project) {
        return {
          ok: false,
          error: {
            error: "Unknown project",
            reason: "unknown_project",
            projectId: resolvedProjectId,
          },
        };
      }
      return {
        ok: true,
        runtime: {
          project,
          approvalQueue: {} as never,
          ownerQuestionQueue: {} as never,
        },
      };
    },
  });
}

function makeUpdate(updateId: number, text: string) {
  return {
    update_id: updateId,
    message: { chat: { id: 99 }, text },
  };
}

function sendBodies(): Array<{ chat_id: string | number; text: string }> {
  return mockedCallTelegramApi.mock.calls
    .filter((call) => call[1] === "sendMessage")
    .map((call) => call[2] as { chat_id: string | number; text: string });
}

async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

function makeCtx(
  bus: EventBus,
  client: KotaClient,
  storage: ModuleStorage,
): ModuleRuntimeContext {
  return {
    cwd: PROJECT_A.projectDir,
    verbose: false,
    config: {} as ModuleRuntimeContext["config"],
    storage,
    registerGroup: () => {},
    getRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
    getContributedControlRoutes: () => [],
    getModuleSummaries: () => [],
    getModuleConfig: () => undefined,
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getSecret: (key) => process.env[key] ?? null,
    listTools: () => [],
    events: makeStubEventProxy(bus),
    createSession: () => ({ send: async () => "", close: () => {} }),
    registerProvider: () => {},
    getProvider: (token) => getProviderRegistry()?.get(token) ?? null,
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
    client,
  };
}

describe("telegram project-scope integration", () => {
  let dir = "";

  afterEach(async () => {
    await telegramModule.onUnload?.();
    if (dir) rmSync(dir, { recursive: true, force: true });
    resetEventBus();
    resetScheduler();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALERT_CHAT_ID;
    agentSessionOptions.length = 0;
    agentSendMock.mockClear();
    agentCloseMock.mockClear();
    mockedCallTelegramApi.mockReset();
    resetProviderRegistry();
  });

  it("boots a two-project daemon and routes Telegram status commands through the selected daemon project", async () => {
    dir = mkdtempSync(join(tmpdir(), "kota-telegram-project-scope-daemon-"));
    const stateDir = join(dir, "daemon-state");
    const dirA = join(dir, "project-a");
    const dirB = join(dir, "project-b");
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    const projectA = buildConfiguredProject({ projectDir: dirA, displayName: "Project A" });
    const projectB = buildConfiguredProject({ projectDir: dirB, displayName: "Project B" });
    const routedCalls: RoutedCall[] = [];
    const token = "daemon-token";
    const chatId = "99";
    process.env.TELEGRAM_BOT_TOKEN = token;
    process.env.TELEGRAM_ALERT_CHAT_ID = chatId;

    let delivered = false;
    mockedCallTelegramApi.mockImplementation(async (_token, method) => {
      if (method === "getUpdates") {
        if (delivered) return [];
        delivered = true;
        return [
          makeUpdate(1, "/memory alpha"),
          makeUpdate(2, `/project ${projectA.projectId}`),
          makeUpdate(3, "/memory alpha"),
          makeUpdate(4, `/project ${projectB.projectId}`),
          makeUpdate(5, "/memory alpha"),
          makeUpdate(6, "/capture-to-memory beta note"),
          makeUpdate(7, "/retract-memory mem-b"),
        ];
      }
      return { message_id: 100 };
    });

    const telegramStatusChannel: ChannelDef = {
      name: "telegram-status-daemon-project-scope",
      create(channelCtx) {
        let stop: (() => void) | null = null;
        return {
          status: "started",
          adapter: {
            async start() {
              const client = buildDaemonProjectClient(readControlAddress(stateDir));
              const selection = new TelegramProjectSelection(
                client,
                new ModuleStorage(dir, "telegram"),
                [],
              );
              stop = startTelegramStatusPoll(
                token,
                chatId,
                channelCtx.projectDir,
                channelCtx.getWorkflowStatus,
                client.knowledge,
                client.memory,
                client.history,
                client.tasks,
                client.recall,
                client.answer,
                client.capture,
                client.retract,
                channelCtx.log,
                { client, selection },
              );
            },
            stop() {
              stop?.();
            },
          },
        };
      },
    };

    const daemon = new Daemon({
      projects: [
        { projectDir: dirA, displayName: "Project A" },
        { projectDir: dirB, displayName: "Project B" },
      ],
      stateDir,
      idleIntervalMs: 60_000,
      pollIntervalMs: 60_000,
      workflows: [],
      channels: [telegramStatusChannel],
      routes: makeProjectScopedRoutes(routedCalls, projectA),
      config: { defaultAgentHarness: "claude-agent-sdk" },
    });

    const startPromise = daemon.start();
    try {
      await waitFor(() => sendBodies().length >= 7, 3_000);

      expect(sendBodies().some((body) => body.text.includes("not bound to a KOTA project"))).toBe(true);
      expect(sendBodies().some((body) => body.text.includes("alpha lives only in project A"))).toBe(true);
      expect(sendBodies().some((body) => body.text === "No matching memory entries.")).toBe(true);
      expect(routedCalls).toEqual(
        expect.arrayContaining([
          { kind: "memory", projectId: projectA.projectId, query: "alpha" },
          { kind: "memory", projectId: projectB.projectId, query: "alpha" },
          { kind: "capture", projectId: projectB.projectId, text: "beta note" },
          { kind: "retract", projectId: projectB.projectId, id: "mem-b" },
        ]),
      );

      const client = buildDaemonProjectClient(readControlAddress(stateDir));
      telegramModule.onLoad!(
        makeCtx(getEventBus() ?? new EventBus(), client, new ModuleStorage(dir, "telegram")),
      );
      mockedCallTelegramApi.mockClear();
      getEventBus()?.emit("workflow.failure.alert", {
        projectId: projectB.projectId,
        workflow: "builder",
        runId: "run-b",
        status: "failed",
        durationMs: 1000,
        errorSummary: "boom",
        text: "Workflow failed: *builder*",
      });
      await waitFor(() => sendBodies().length === 1);
      expect(sendBodies()[0]?.text).toBe("[Project B] Workflow failed: *builder*");
    } finally {
      await daemon.stop();
      await startPromise;
    }
  });

  it("starts Telegram interactive sessions with the selected daemon project runtime bundle", async () => {
    dir = mkdtempSync(join(tmpdir(), "kota-telegram-interactive-project-scope-"));
    const stateDir = join(dir, "daemon-state");
    const dirA = join(dir, "project-a");
    const dirB = join(dir, "project-b");
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    const projectB = buildConfiguredProject({ projectDir: dirB, displayName: "Project B" });

    process.env.TELEGRAM_BOT_TOKEN = "daemon-token";
    process.env.TELEGRAM_ALERT_CHAT_ID = "99";
    let clientRef: KotaClient | null = null;
    const bus = new EventBus();
    const ctx = makeCtx(bus, {} as KotaClient, new ModuleStorage(dir, "telegram"));
    Object.defineProperty(ctx, "client", {
      get: () => {
        if (!clientRef) throw new Error("daemon client not ready");
        return clientRef;
      },
    });
    ctx.getModuleConfig = () =>
      ({ defaultAutonomyMode: "supervised" }) as never;

    if (typeof telegramModule.channels !== "function") {
      throw new Error("expected telegramModule.channels to be a factory");
    }
    const resolved = telegramModule.channels(ctx);
    const channels = Array.isArray(resolved) ? resolved : await resolved;
    const interactive = channels.find((c) => c.name === "telegram-interactive");
    if (!interactive) throw new Error("telegram-interactive channel missing");
    const wrappedInteractive: ChannelDef = {
      ...interactive,
      create(channelCtx) {
        clientRef = buildDaemonProjectClient(readControlAddress(stateDir));
        return interactive.create(channelCtx);
      },
    };

    let pollCount = 0;
    mockedCallTelegramApi.mockImplementation(async (_token, method) => {
      if (method === "getMe") {
        return { id: 1, first_name: "Bot", username: "kota_bot" };
      }
      if (method === "getUpdates") {
        pollCount += 1;
        if (pollCount === 1) return [makeUpdate(10, `/project ${projectB.projectId}`)];
        if (pollCount === 2) {
          await waitFor(
            () => sendBodies().some((body) => body.text.includes("Telegram chat is now using")),
            1_000,
          );
          return [makeUpdate(11, "hello from project b")];
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        return [];
      }
      return { message_id: 200 };
    });

    const daemon = new Daemon({
      projects: [
        { projectDir: dirA, displayName: "Project A" },
        { projectDir: dirB, displayName: "Project B" },
      ],
      stateDir,
      idleIntervalMs: 60_000,
      pollIntervalMs: 60_000,
      workflows: [],
      channels: [wrappedInteractive],
      config: {
        defaultAgentHarness: "claude-agent-sdk",
        modules: { telegram: { defaultAutonomyMode: "supervised" } },
      },
    });

    const startPromise = daemon.start();
    try {
      await waitFor(() => agentSendMock.mock.calls.length > 0, 3_000);
      expect(agentSendMock).toHaveBeenCalledWith("hello from project b");
      expect(agentSessionOptions).toHaveLength(1);
      const options = agentSessionOptions[0]!;
      expect(options.projectDir).toBe(projectB.projectDir);
      const projectRuntime = options.projectRuntime;
      if (!projectRuntime) throw new Error("Telegram session did not receive a project runtime");
      expect(projectRuntime.project.projectId).toBe(projectB.projectId);
      expect(projectRuntime.project.projectDir).toBe(projectB.projectDir);
    } finally {
      await daemon.stop();
      await startPromise;
    }
  });

  it("starts the real status channel with a pre-daemon local client and the daemon project provider", async () => {
    dir = mkdtempSync(join(tmpdir(), "kota-telegram-local-client-project-scope-"));
    registerDaemonProjectScopeProvider();
    process.env.TELEGRAM_BOT_TOKEN = "daemon-token";
    process.env.TELEGRAM_ALERT_CHAT_ID = "99";

    const storage = new ModuleStorage(dir, "telegram");
    const spies = makeSpies();
    const localClient = makeClient(spies, {
      ok: false,
      reason: "daemon_required",
    });
    let delivered = false;
    mockedCallTelegramApi.mockImplementation(async (_token, method) => {
      if (method === "getUpdates") {
        if (delivered) return [];
        delivered = true;
        return [
          makeUpdate(1, "/project project-b"),
          makeUpdate(2, "/memory alpha"),
        ];
      }
      return { message_id: 100 };
    });

    if (typeof telegramModule.channels !== "function") {
      throw new Error("expected telegramModule.channels to be a factory");
    }
    const resolved = telegramModule.channels(
      makeCtx(new EventBus(), localClient, storage),
    );
    const channels = Array.isArray(resolved) ? resolved : await resolved;
    const status = channels.find((c) => c.name === "telegram-status");
    if (!status) throw new Error("telegram-status channel missing");
    const runtimeA = makeProjectRuntime(PROJECT_A);
    const runtimeB = makeProjectRuntime(PROJECT_B);
    const started = status.create({
      projectDir: PROJECT_A.projectDir,
      defaultProjectRuntime: runtimeA,
      getProjectRuntime: (projectId: string) => {
        if (projectId === PROJECT_A.projectId) return runtimeA;
        if (projectId === PROJECT_B.projectId) return runtimeB;
        throw new Error(`unknown project ${projectId}`);
      },
      log: () => {},
      getWorkflowStatus: makeStatusInfo,
    });
    if (started.status !== "started") {
      throw new Error(`telegram-status did not start: ${started.status}`);
    }

    await started.adapter.start();
    try {
      await waitFor(() => sendBodies().length >= 2);
    } finally {
      await started.adapter.stop();
    }

    expect(localClient.projects.list).not.toHaveBeenCalled();
    expect(sendBodies().some((body) => body.text.includes("Project selection requires"))).toBe(false);
    expect(sendBodies().some((body) => body.text.includes("Telegram chat is now using Project B"))).toBe(true);
    expect(spies.get(PROJECT_B.projectId)!.memorySearch).toHaveBeenCalledWith("alpha", {
      semantic: true,
      limit: 10,
    });
  });

  it("routes status commands, interactive sessions, and notifications through the selected project", async () => {
    dir = mkdtempSync(join(tmpdir(), "kota-telegram-project-scope-"));
    const storage = new ModuleStorage(dir, "telegram");
    const spies = makeSpies();
    const client = makeClient(spies);
    const selection = new TelegramProjectSelection(client, storage, []);

    let firstPoll = true;
    mockedCallTelegramApi.mockImplementation(async (_token, method) => {
      if (method === "getUpdates") {
        if (!firstPoll) return [];
        firstPoll = false;
        return [
          makeUpdate(1, "/memory alpha"),
          makeUpdate(2, "/project project-a"),
          makeUpdate(3, "/memory alpha"),
          makeUpdate(4, "/project project-b"),
          makeUpdate(5, "/memory alpha"),
          makeUpdate(6, "/capture-to-memory beta note"),
          makeUpdate(7, "/retract-memory mem-b"),
          makeUpdate(8, "/status"),
        ];
      }
      return { message_id: 100 };
    });

    const stopStatus = startTelegramStatusPoll(
      "token",
      "99",
      PROJECT_A.projectDir,
      makeStatusInfo,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      () => {},
      { client, selection },
    );
    await waitFor(() => sendBodies().length >= 8);
    stopStatus();

    const projectASpies = spies.get(PROJECT_A.projectId)!;
    const projectBSpies = spies.get(PROJECT_B.projectId)!;
    expect(projectASpies.memorySearch).toHaveBeenCalledWith("alpha", {
      semantic: true,
      limit: 10,
    });
    expect(projectBSpies.memorySearch).toHaveBeenCalledWith("alpha", {
      semantic: true,
      limit: 10,
    });
    expect(projectBSpies.capture).toHaveBeenCalledWith("beta note", {
      target: "memory",
    });
    expect(projectBSpies.retract).toHaveBeenCalledWith({
      target: "memory",
      id: "mem-b",
    });
    expect(projectBSpies.workflowStatus).toHaveBeenCalledOnce();
    expect(projectASpies.workflowStatus).not.toHaveBeenCalled();
    expect(projectASpies.capture).not.toHaveBeenCalled();
    expect(projectASpies.retract).not.toHaveBeenCalled();
    expect(sendBodies().some((body) => body.text.includes("not bound to a KOTA project"))).toBe(true);
    expect(sendBodies().some((body) => body.text.includes("alpha lives only in project A"))).toBe(true);
    expect(sendBodies().some((body) => body.text === "No matching memory entries.")).toBe(true);

    mockedCallTelegramApi.mockClear();
    process.env.TELEGRAM_BOT_TOKEN = "token";
    process.env.TELEGRAM_ALERT_CHAT_ID = "99";
    const bus = new EventBus();
    telegramModule.onLoad!(makeCtx(bus, client, storage));
    bus.emit("workflow.failure.alert", {
      projectId: PROJECT_B.projectId,
      workflow: "builder",
      runId: "run-b",
      status: "failed",
      durationMs: 1000,
      errorSummary: "boom",
      text: "Workflow failed: *builder*",
    });
    await waitFor(() => sendBodies().length === 1);
    expect(sendBodies()[0]?.text).toBe("[Project B] Workflow failed: *builder*");
    await telegramModule.onUnload?.();

    mockedCallTelegramApi.mockClear();
    let bot: TelegramBot;
    const runtimeA = makeProjectRuntime(PROJECT_A);
    const runtimeB = makeProjectRuntime(PROJECT_B);
    let getUpdatesCount = 0;
    mockedCallTelegramApi.mockImplementation(async (_token, method) => {
      if (method === "getMe") {
        return { id: 1, first_name: "Bot", username: "kota_bot" };
      }
      if (method === "getUpdates") {
        getUpdatesCount += 1;
        if (getUpdatesCount === 1) return [makeUpdate(10, "hello from selected project")];
        if (getUpdatesCount === 2) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return [makeUpdate(11, "/project project-a")];
        }
        if (getUpdatesCount === 3) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return [makeUpdate(12, "hello from project a")];
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        bot.stop();
        return [];
      }
      return { message_id: 200 };
    });

    bot = new TelegramBot({
      token: "token",
      autonomyMode: "supervised",
      defaultProjectRuntime: runtimeA,
      getProjectRuntime: (projectId) => {
        if (projectId === PROJECT_A.projectId) return runtimeA;
        if (projectId === PROJECT_B.projectId) return runtimeB;
        throw new Error(`unknown project ${projectId}`);
      },
      projectSelection: selection,
    });
    await bot.start();

    expect(agentSessionOptions.map((options) => options.projectDir)).toEqual([
      PROJECT_B.projectDir,
      PROJECT_A.projectDir,
    ]);
    expect(agentSendMock).toHaveBeenCalledWith("hello from selected project");
    expect(agentSendMock).toHaveBeenCalledWith("hello from project a");
    expect(agentCloseMock).toHaveBeenCalled();
  });
});
