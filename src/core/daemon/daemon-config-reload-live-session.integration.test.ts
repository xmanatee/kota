import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaConfig } from "#core/config/config.js";
import { loadConfig } from "#core/config/config.js";
import { EventBus, resetEventBus } from "#core/events/event-bus.js";
import { AgentSession } from "#core/loop/loop.js";
import type { Transport } from "#core/loop/transport.js";
import { loadModuleMetadata } from "#core/modules/module-metadata.js";
import type { GuardrailsConfig, GuardrailsSnapshot } from "#core/tools/guardrails.js";
import type { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRuntime } from "#core/workflow/runtime.js";
import type { DaemonConfig } from "./daemon.js";
import { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import { DaemonControlServer } from "./daemon-control.js";
import { buildDaemonHandle } from "./daemon-handle.js";
import type { ProjectRegistry } from "./project-registry.js";
import type { ProjectRuntime, ProjectRuntimeRegistry } from "./project-runtime.js";

const { mockStreamMessage } = vi.hoisted(() => ({
  mockStreamMessage: vi.fn(),
}));

vi.mock("#core/config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#core/config/config.js")>();
  return {
    ...actual,
    loadConfig: vi.fn(),
  };
});

vi.mock("#core/modules/module-metadata.js", () => ({
  loadModuleMetadata: vi.fn(),
}));

vi.mock("#core/model/model-client.js", () => ({
  createModelClient: vi.fn(() => ({
    client: { messages: { stream: vi.fn(), create: vi.fn() } },
    model: "claude-sonnet-4-6",
    providerName: "anthropic",
  })),
  registerModelClientFactory: vi.fn(),
}));

vi.mock("#core/model/streaming.js", () => ({
  streamMessage: mockStreamMessage,
}));

vi.mock("#core/loop/project-context.js", () => ({
  loadProjectContext: vi.fn(() => ""),
}));

vi.mock("#core/loop/instruction-files.js", () => ({
  loadInstructionContext: vi.fn(() => ""),
}));

vi.mock("#root/init.js", () => ({
  buildSessionWarmup: vi.fn(() => ""),
}));

vi.mock("#core/mcp/manager.js", () => ({
  McpManager: class MockMcpManager {
    static loadConfig() {
      return null;
    }
  },
}));

vi.mock("#core/modules/project-discovery.js", () => ({
  discoverProjectModules: vi.fn(async () => []),
}));

vi.mock("#core/modules/module-discovery.js", () => ({
  discoverModules: vi.fn(async () => []),
}));

const TEST_TOKEN = "test-config-reload-live-session-token";

type SseEvent = {
  event: string;
  data: unknown;
};

type StartedDaemon = {
  projectDir: string;
  server: DaemonControlServer;
  port: number;
};

function textResponse(text: string) {
  return {
    response: {
      content: [{ type: "text" as const, text }],
      usage: { input_tokens: 100, output_tokens: 50 },
    },
    streamedText: text,
  };
}

function dangerousShellResponse(id: string) {
  return {
    response: {
      content: [
        {
          type: "tool_use" as const,
          id,
          name: "shell",
          input: { command: "rm -rf /tmp/kota-live-session-guardrail-test" },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    },
    streamedText: "",
  };
}

function parseSse(raw: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const frame of raw.split(/\n\n+/)) {
    const lines = frame.split("\n").filter(Boolean);
    if (lines.length === 0) continue;

    let event = "message";
    const data: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice("event:".length).trim();
      if (line.startsWith("data:")) data.push(line.slice("data:".length).trim());
    }
    if (data.length === 0) continue;

    const payload = data.join("\n");
    try {
      events.push({ event, data: JSON.parse(payload) as unknown });
    } catch {
      events.push({ event, data: payload });
    }
  }
  return events;
}

async function fetchWithToken(
  port: number,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${TEST_TOKEN}`);
  return globalThis.fetch(`http://127.0.0.1:${port}${path}`, {
    ...options,
    headers,
  });
}

async function postJson(
  port: number,
  path: string,
  body: Record<string, unknown> = {},
): Promise<Response> {
  return fetchWithToken(port, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createDaemonSession(port: number): Promise<string> {
  const res = await postJson(port, "/sessions", { autonomy_mode: "autonomous" });
  expect(res.status).toBe(201);
  const body = await res.json() as { session_id: string };
  return body.session_id;
}

async function chat(port: number, sessionId: string, message: string): Promise<SseEvent[]> {
  const res = await postJson(port, `/sessions/${sessionId}/chat`, { message });
  expect(res.status).toBe(200);
  return parseSse(await res.text());
}

async function reloadConfig(
  port: number,
  nextConfig: KotaConfig,
): Promise<{
  ok: boolean;
  workflows: number;
  changedModules: string[];
  sessionGuardrails: {
    refreshed: number;
    unchanged: number;
    nonRefreshable: Array<Record<string, unknown>>;
  };
}> {
  vi.mocked(loadConfig).mockReturnValue(nextConfig);
  const res = await fetchWithToken(port, "/reload", { method: "POST" });
  expect(res.status).toBe(200);
  return await res.json();
}

async function getSessionSnapshot(
  port: number,
  sessionId: string,
): Promise<GuardrailsSnapshot> {
  const res = await fetchWithToken(port, "/status");
  expect(res.status).toBe(200);
  const body = await res.json() as {
    sessions: Array<{
      id: string;
      guardrailsSnapshot?: GuardrailsSnapshot;
    }>;
  };
  const session = body.sessions.find((entry) => entry.id === sessionId);
  expect(session?.guardrailsSnapshot).toBeDefined();
  return session!.guardrailsSnapshot!;
}

function mockModuleMetadata(): void {
  vi.mocked(loadModuleMetadata).mockResolvedValue({
    getModuleSummaries: () => [
      { name: "git", dependencies: [] },
      { name: "github", dependencies: ["git"] },
    ],
    getContributedWorkflows: () => [],
  } as unknown as Awaited<ReturnType<typeof loadModuleMetadata>>);
}

async function startDaemonWithLiveSessionReload(
  initialConfig: KotaConfig,
): Promise<StartedDaemon> {
  const projectDir = mkdtempSync(join(tmpdir(), "kota-live-session-reload-"));
  const stateDir = join(projectDir, ".kota");
  const workflowRuntime = {
    getState: vi.fn(() => ({
      activeRuns: [],
      pendingRuns: [],
      queueLength: 0,
      completedRuns: 0,
      workflows: {},
      paused: false,
      agentConcurrency: 1,
      codeConcurrency: 4,
    })),
    getDispatchWindowStatus: vi.fn(() => ({ blocked: false })),
    isDispatchPaused: vi.fn(() => false),
    setWorkflowInputs: vi.fn(),
    reloadWorkflowDefinitions: vi.fn(() => ({ count: 0 })),
    getDefinitionCount: vi.fn(() => 0),
  };
  const runtime = {
    project: {
      projectId: "test-project",
      projectDir,
      displayName: "test-project",
    },
    workflowRuntime,
    runStore: {} as WorkflowRunStore,
  } as unknown as ProjectRuntime;
  const projectRuntimes = {
    list: vi.fn(() => [runtime]),
    getDefault: vi.fn(() => runtime),
    get: vi.fn(() => runtime),
  } as unknown as ProjectRuntimeRegistry;
  const projectRegistry = {
    get: vi.fn((projectId: string) =>
      projectId === "test-project" ? runtime.project : undefined,
    ),
    getDefaultProjectId: vi.fn(() => "test-project"),
    toProjection: vi.fn(() => ({
      defaultProjectId: "test-project",
      projects: [runtime.project],
    })),
  } as unknown as ProjectRegistry;
  const daemonConfig: DaemonConfig = {
    config: initialConfig,
    verbose: false,
  };
  const bus = new EventBus();
  let server!: DaemonControlServer;
  let conversationCounter = 0;
  const conversations = new Set<string>();

  const handle = buildDaemonHandle({
    getState: () => ({
      startedAt: "2026-01-01T00:00:00.000Z",
      completedRuns: 0,
      pid: 1234,
    }),
    isRunning: () => true,
    workflows: workflowRuntime as unknown as WorkflowRuntime,
    bus,
    sessions: new Map(),
    runStore: {} as WorkflowRunStore,
    projectDir,
    projectRegistry,
    projectRuntimes,
    config: daemonConfig,
    refreshLiveSessionGuardrails: (guardrailsConfig) =>
      server.refreshChatSessionGuardrails(guardrailsConfig),
    log: () => {},
    getModuleHealthChecks: () => ({}),
    probeCapabilityReadiness: async () => ({
      capabilities: [],
      summary: { ready: 0, unavailable: 0, init_failed: 0 },
    }),
    getChannelStatuses: () => [],
  });

  server = new DaemonControlServer(handle, TEST_TOKEN, {
    makeAgent: (transport: Transport, autonomyMode) =>
      new AgentSession({
        autonomyMode,
        transport,
        config: daemonConfig.config,
        projectDir,
        noHistory: true,
      }),
    defaultAutonomyMode: "autonomous",
    chatBindings: new DaemonChatBindingStore(stateDir),
    conversationResolver: {
      conversationExists: (conversationId) => conversations.has(conversationId),
      createConversation: () => {
        const conversationId = `conv-${++conversationCounter}`;
        conversations.add(conversationId);
        return conversationId;
      },
    },
  });

  const port = await server.start();
  return { projectDir, server, port };
}

describe("daemon config reload live-session guardrails", () => {
  let subject: StartedDaemon | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    resetEventBus();
    mockModuleMetadata();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    if (subject) {
      await subject.server.stop();
      rmSync(subject.projectDir, { recursive: true, force: true });
      subject = null;
    }
    resetEventBus();
    vi.restoreAllMocks();
  });

  it("denies the next dangerous tool call in an existing session after daemon reload tightens guardrails", async () => {
    const permissiveGuardrails: GuardrailsConfig = {
      policies: { safe: "allow", moderate: "allow", dangerous: "allow" },
    };
    const strictGuardrails: GuardrailsConfig = {
      policies: { safe: "allow", moderate: "allow", dangerous: "deny" },
    };
    subject = await startDaemonWithLiveSessionReload({
      reflection: false,
      guardrails: permissiveGuardrails,
      serve: { defaultAutonomyMode: "autonomous" },
    });
    const sessionId = await createDaemonSession(subject.port);
    const beforeSnapshot = await getSessionSnapshot(subject.port, sessionId);

    mockStreamMessage
      .mockResolvedValueOnce(dangerousShellResponse("tu-before"))
      .mockResolvedValueOnce(textResponse("before reload"));
    const firstEvents = await chat(
      subject.port,
      sessionId,
      "run the destructive command once",
    );
    expect(firstEvents.find((event) => event.event === "guardrail")?.data)
      .toMatchObject({ tool: "shell", risk: "dangerous", policy: "allow" });

    const reload = await reloadConfig(subject.port, {
      reflection: false,
      guardrails: strictGuardrails,
      serve: { defaultAutonomyMode: "autonomous" },
    });
    expect(reload.sessionGuardrails).toEqual({
      refreshed: 1,
      unchanged: 0,
      nonRefreshable: [],
    });
    const reloadedSnapshot = await getSessionSnapshot(subject.port, sessionId);
    expect(reloadedSnapshot.id).not.toBe(beforeSnapshot.id);
    expect(reloadedSnapshot.generation).toBe(beforeSnapshot.generation + 1);

    mockStreamMessage
      .mockResolvedValueOnce(dangerousShellResponse("tu-after"))
      .mockResolvedValueOnce(textResponse("after reload"));
    const secondEvents = await chat(
      subject.port,
      sessionId,
      "run the same destructive command again",
    );

    expect(secondEvents.find((event) => event.event === "guardrail")?.data)
      .toMatchObject({ tool: "shell", risk: "dangerous", policy: "deny" });
  });

  it("does not churn the session guardrails snapshot on a module-only reload", async () => {
    const guardrails: GuardrailsConfig = {
      policies: { safe: "allow", moderate: "allow", dangerous: "deny" },
    };
    subject = await startDaemonWithLiveSessionReload({
      reflection: false,
      guardrails,
      serve: { defaultAutonomyMode: "autonomous" },
      modules: { git: { token: "old" } },
    });
    const sessionId = await createDaemonSession(subject.port);
    const beforeSnapshot = await getSessionSnapshot(subject.port, sessionId);

    const reload = await reloadConfig(subject.port, {
      reflection: false,
      guardrails,
      serve: { defaultAutonomyMode: "autonomous" },
      modules: { git: { token: "new" } },
    });

    expect(reload.changedModules).toEqual(["git", "github"]);
    expect(reload.sessionGuardrails).toEqual({
      refreshed: 0,
      unchanged: 1,
      nonRefreshable: [],
    });
    await expect(getSessionSnapshot(subject.port, sessionId))
      .resolves.toEqual(beforeSnapshot);
  });
});
