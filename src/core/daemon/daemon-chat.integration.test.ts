import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEventBus } from "#core/events/event-bus.js";
import { registerModelClientFactory } from "#core/model/model-client.js";
import {
  HISTORY_PROJECT_PROVIDER_TOKEN,
  HISTORY_PROVIDER_TOKEN,
  type HistoryProvider,
  initProviderRegistry,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import {
  cloneGuardrailsConfig,
  createGuardrailsSnapshot,
  fingerprintGuardrailsConfig,
  type GuardrailsConfig,
} from "#core/tools/guardrails.js";
import { Daemon } from "./daemon.js";
import { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import type { DaemonChatConversationResolver } from "./daemon-chat-handlers.js";
import {
  type DaemonControlHandle,
  DaemonControlServer,
  type WorkflowLiveStatus,
  type WorkflowMetricCounts,
} from "./daemon-control.js";
import { deriveProjectId } from "./project-registry.js";
import { resetScheduler } from "./scheduler.js";

const CONV_ID = "c-fixture-0000";
const DEFAULT_PROJECT_ID = "test-project-id";
const OTHER_PROJECT_ID = "other-project-id";
const DEFAULT_PROJECT_DIR = "/tmp/test-project";
const OTHER_PROJECT_DIR = "/tmp/other-project";

function makeBindingStore(): DaemonChatBindingStore {
  const dir = mkdtempSync(join(tmpdir(), "kota-chat-bindings-"));
  return new DaemonChatBindingStore(dir);
}

function makeResolver(conversations: Set<string> = new Set([CONV_ID])): DaemonChatConversationResolver {
  let counter = 0;
  return {
    conversationExists: (id: string) => conversations.has(id),
    createConversation: () => {
      const id = `conv-${++counter}`;
      conversations.add(id);
      return id;
    },
  };
}

function mockAgentSession(sendResult?: unknown, mode: "passive" | "supervised" | "autonomous" = "supervised") {
  let current = mode;
  let guardrailsConfig: GuardrailsConfig = {
    policies: { safe: "allow", moderate: "allow", dangerous: "confirm" },
  };
  let guardrailsSnapshot = createGuardrailsSnapshot(guardrailsConfig, 0);
  return {
    send: vi.fn(async () => sendResult ?? { status: "ok" }),
    cancelActiveTurn: vi.fn(),
    close: vi.fn(),
    getAutonomyMode: vi.fn(() => current),
    setAutonomyMode: vi.fn((next: "passive" | "supervised" | "autonomous") => { current = next; }),
    getGuardrailsSnapshot: vi.fn(() => ({ ...guardrailsSnapshot })),
    replaceGuardrailsConfig: vi.fn((nextConfig: GuardrailsConfig) => {
      const nextId = fingerprintGuardrailsConfig(nextConfig);
      if (nextId === guardrailsSnapshot.id) {
        return { changed: false, snapshot: { ...guardrailsSnapshot } };
      }
      guardrailsConfig = cloneGuardrailsConfig(nextConfig);
      guardrailsSnapshot = createGuardrailsSnapshot(
        guardrailsConfig,
        guardrailsSnapshot.generation + 1,
      );
      return { changed: true, snapshot: { ...guardrailsSnapshot } };
    }),
  };
}

function makeHandle(overrides: Partial<DaemonControlHandle> = {}): DaemonControlHandle {
  const defaultWorkflowStatus: WorkflowLiveStatus = {
    activeRuns: [],
    pendingRuns: [],
    queueLength: 0,
    completedRuns: 0,
    workflows: {},
    paused: false,
    agentConcurrency: 1,
    codeConcurrency: 4,
  };
  return {
    getDaemonLiveState: vi.fn(() => ({
      startedAt: "2026-01-01T00:00:00.000Z",
      completedRuns: 0,
      pid: 9999,
      running: true,
    })),
    getHealthStatus: vi.fn(() => ({ scheduler: "ok" as const, modules: "ok" as const })),
    getWorkflowLiveStatus: vi.fn(() => ({ ...defaultWorkflowStatus })),
    listChannelStatuses: vi.fn(() => []),
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
    getWorkflowMetricCounts: vi.fn((): WorkflowMetricCounts => ({ runCounts: [], costTotals: [], durationHistogram: [] })),
    registerSession: vi.fn(),
    unregisterSession: vi.fn(),
    listSessions: vi.fn(() => []),
    setSessionAutonomyMode: vi.fn(() => ({ ok: false, notFound: true })),
    getProjectRegistryProjection: vi.fn(() => ({ defaultProjectId: DEFAULT_PROJECT_ID, projects: [{ projectId: DEFAULT_PROJECT_ID, projectDir: DEFAULT_PROJECT_DIR, displayName: "test-project" }] })),
    hasProject: vi.fn((id: string) => id === DEFAULT_PROJECT_ID),
    getActiveProjectId: vi.fn(() => null),
    setActiveProjectId: vi.fn((id: string | null) => (id === null ? { ok: true as const, activeProjectId: null } : id === DEFAULT_PROJECT_ID ? { ok: true as const, activeProjectId: id } : { ok: false as const, reason: "not_found" as const, projectId: id })),
    reloadConfig: vi.fn(async () => ({ workflows: 0, changedModules: [] as string[], sessionGuardrails: { refreshed: 0, unchanged: 0, nonRefreshable: [] } })),
    probeCapabilityReadiness: vi.fn(async () => ({ capabilities: [], summary: { ready: 0, unavailable: 0, init_failed: 0 } })),
    getClientIdentity: vi.fn(async () => ({
      projectName: "test-project",
      projectDir: DEFAULT_PROJECT_DIR,
      projects: { defaultProjectId: DEFAULT_PROJECT_ID, projects: [{ projectId: DEFAULT_PROJECT_ID, projectDir: DEFAULT_PROJECT_DIR, displayName: "test-project" }] },
      daemonVersion: "0.1.0",
      pid: 9999,
      startedAt: "2026-01-01T00:00:00.000Z",
      dashboard: {
        available: false as const,
        reason: "not_contributed",
        message: "No module contributed a dashboard capability.",
      },
    })),
    ...overrides,
  };
}

// --- Integration: DaemonControlServer with chat pool ---

const TEST_TOKEN = "test-chat-token-xyz";

async function fetchWithToken(port: number, path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${TEST_TOKEN}`);
  return globalThis.fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers });
}

function readDaemonControlAddress(stateDir: string): { port: number; token: string } {
  return JSON.parse(readFileSync(join(stateDir, "daemon-control.json"), "utf-8"));
}

async function fetchWithDaemonToken(
  port: number,
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return globalThis.fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers });
}

function installMockModelClient(): void {
  registerModelClientFactory(({ model }) => ({
    model,
    providerName: "test",
    client: {
      messages: {
        async create() {
          return modelResponse(model, "daemon reply");
        },
        stream() {
          const textHandlers: Array<(delta: string) => void> = [];
          return {
            on(event: "text" | "thinking", cb: (delta: string) => void) {
              if (event === "text") textHandlers.push(cb);
              return this;
            },
            async finalMessage() {
              for (const handler of textHandlers) handler("daemon reply");
              return modelResponse(model, "daemon reply");
            },
          };
        },
      },
    },
  }));
}

function modelResponse(model: string, text: string) {
  return {
    id: "msg-test",
    role: "assistant" as const,
    model,
    content: [{ type: "text" as const, text }],
    stop_reason: "end_turn" as const,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
    },
  };
}

function makeFileHistoryProvider(projectDir: string): HistoryProvider {
  const dir = join(projectDir, ".kota", "history");
  let counter = 0;
  const loadIndex = () => {
    const path = join(dir, "index.json");
    if (!existsSync(path)) return { conversations: [] };
    return JSON.parse(readFileSync(path, "utf-8"));
  };
  const saveIndex = (index: { conversations: Array<Record<string, unknown>> }) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.json"), JSON.stringify(index, null, 2));
  };
  return {
    create(model, cwd, source) {
      mkdirSync(dir, { recursive: true });
      const id = `test-conv-${++counter}`;
      const now = new Date().toISOString();
      const record = {
        id,
        title: "(new conversation)",
        createdAt: now,
        updatedAt: now,
        model,
        messageCount: 0,
        cwd,
        source: source ?? "user",
      };
      writeFileSync(
        join(dir, `${id}.json`),
        JSON.stringify({
          record,
          messages: [],
          compactionCount: 0,
          lastInputTokens: 0,
        }, null, 2),
      );
      const index = loadIndex();
      index.conversations.unshift(record);
      saveIndex(index);
      return id;
    },
    save(id, messages, compactionCount, lastInputTokens) {
      const data = this.load(id);
      if (!data) return;
      const record = {
        ...data.record,
        updatedAt: new Date().toISOString(),
        messageCount: messages.length,
      };
      writeFileSync(
        join(dir, `${id}.json`),
        JSON.stringify({ record, messages, compactionCount, lastInputTokens }, null, 2),
      );
    },
    load(id) {
      const path = join(dir, `${id}.json`);
      if (!existsSync(path)) return null;
      return JSON.parse(readFileSync(path, "utf-8"));
    },
    list() {
      return loadIndex().conversations as ReturnType<HistoryProvider["list"]>;
    },
    getMostRecent() {
      return this.list({ limit: 1 })[0] ?? null;
    },
    findByPrefix(idOrPrefix) {
      return this.list({ limit: 100 }).find((record) => record.id.startsWith(idOrPrefix)) ?? null;
    },
    remove(id) {
      const index = loadIndex();
      const before = index.conversations.length;
      index.conversations = index.conversations.filter(
        (record: { id?: string }) => record.id !== id,
      );
      saveIndex(index);
      return index.conversations.length !== before;
    },
    cleanup() {
      return 0;
    },
    supportsSemanticSearch() {
      return false;
    },
    async semanticSearch() {
      return [];
    },
    async reindex() {
      return { indexed: 0, failed: 0, skipped: true };
    },
  };
}

describe("DaemonControlServer chat endpoints", () => {
  let server: DaemonControlServer;
  let port: number;
  let bindingsDir: string;
  let bindings: DaemonChatBindingStore;

  beforeEach(async () => {
    bindingsDir = mkdtempSync(join(tmpdir(), "kota-chat-bindings-"));
    bindings = new DaemonChatBindingStore(bindingsDir);
    const handle = makeHandle();
    server = new DaemonControlServer(handle, TEST_TOKEN, {
      makeAgent: (_transport, mode) => {
        const agent = mockAgentSession({ result: "ok" }, mode);
        return agent as never;
      },
      defaultAutonomyMode: "supervised",
      chatBindings: bindings,
      conversationResolver: makeResolver(new Set()),
    });
    port = await server.start();
  });

  afterEach(async () => {
    await server.stop();
    rmSync(bindingsDir, { recursive: true, force: true });
  });

  it("POST /sessions creates a daemon session", async () => {
    const res = await fetchWithToken(port, "/sessions", { method: "POST" });
    expect(res.status).toBe(201);
    const body = await res.json() as { session_id: string };
    expect(body.session_id).toBeTruthy();
  });

  it("POST /sessions returns 400 without request mode when no default is configured", async () => {
    const handle = makeHandle();
    const serverWithoutDefault = new DaemonControlServer(handle, TEST_TOKEN, {
      makeAgent: (_transport, mode) => mockAgentSession({ result: "ok" }, mode) as never,
      chatBindings: makeBindingStore(),
      conversationResolver: makeResolver(new Set()),
    });
    const portWithoutDefault = await serverWithoutDefault.start();
    try {
      const res = await fetchWithToken(portWithoutDefault, "/sessions", { method: "POST" });
      expect(res.status).toBe(400);
    } finally {
      await serverWithoutDefault.stop();
    }
  });

  it("POST /sessions accepts request mode when no default is configured", async () => {
    const handle = makeHandle();
    const serverWithoutDefault = new DaemonControlServer(handle, TEST_TOKEN, {
      makeAgent: (_transport, mode) => mockAgentSession({ result: "ok" }, mode) as never,
      chatBindings: makeBindingStore(),
      conversationResolver: makeResolver(new Set()),
    });
    const portWithoutDefault = await serverWithoutDefault.start();
    try {
      const res = await fetchWithToken(portWithoutDefault, "/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autonomy_mode: "autonomous" }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as { autonomy_mode: string };
      expect(body.autonomy_mode).toBe("autonomous");
    } finally {
      await serverWithoutDefault.stop();
    }
  });

  it("GET /sessions includes daemon sessions with source daemon", async () => {
    await fetchWithToken(port, "/sessions", { method: "POST" });
    const res = await fetchWithToken(port, "/sessions");
    expect(res.status).toBe(200);
    const body = await res.json() as { sessions: Array<{ source: string; guardrailsSnapshot?: { id: string } }> };
    expect(body.sessions.some((s) => s.source === "daemon")).toBe(true);
    expect(body.sessions.find((s) => s.source === "daemon")?.guardrailsSnapshot?.id).toMatch(/^gr_/);
  });

  it("POST /sessions creates the daemon agent for the requested project id", async () => {
    const seenProjectIds: string[] = [];
    const projectHandle = makeHandle({
      getProjectRegistryProjection: vi.fn(() => ({
        defaultProjectId: DEFAULT_PROJECT_ID,
        projects: [
          {
            projectId: DEFAULT_PROJECT_ID,
            projectDir: DEFAULT_PROJECT_DIR,
            displayName: "test-project",
          },
          {
            projectId: OTHER_PROJECT_ID,
            projectDir: OTHER_PROJECT_DIR,
            displayName: "other-project",
          },
        ],
      })),
      hasProject: vi.fn((id: string) => id === DEFAULT_PROJECT_ID || id === OTHER_PROJECT_ID),
    });
    const projectBindingsDir = mkdtempSync(join(tmpdir(), "kota-chat-project-"));
    const projectServer = new DaemonControlServer(projectHandle, TEST_TOKEN, {
      makeAgent: (_transport, mode, _resume, projectId) => {
        seenProjectIds.push(projectId);
        return mockAgentSession({ result: "ok" }, mode) as never;
      },
      defaultAutonomyMode: "supervised",
      chatBindings: new DaemonChatBindingStore(projectBindingsDir),
      conversationResolver: makeResolver(new Set()),
    });
    const projectPort = await projectServer.start();
    try {
      const createRes = await fetchWithToken(projectPort, `/sessions?projectId=${OTHER_PROJECT_ID}`, {
        method: "POST",
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json() as { session_id: string; project_id: string };
      expect(created.project_id).toBe(OTHER_PROJECT_ID);
      expect(seenProjectIds).toEqual([OTHER_PROJECT_ID]);

      const defaultListRes = await fetchWithToken(projectPort, `/sessions?projectId=${DEFAULT_PROJECT_ID}`);
      const defaultList = await defaultListRes.json() as { sessions: Array<{ id: string }> };
      expect(defaultList.sessions.map((s) => s.id)).not.toContain(created.session_id);

      const selectedListRes = await fetchWithToken(projectPort, `/sessions?projectId=${OTHER_PROJECT_ID}`);
      const selectedList = await selectedListRes.json() as { sessions: Array<{ id: string; projectId: string }> };
      expect(selectedList.sessions).toEqual([
        expect.objectContaining({ id: created.session_id, projectId: OTHER_PROJECT_ID }),
      ]);
    } finally {
      await projectServer.stop();
      rmSync(projectBindingsDir, { recursive: true, force: true });
    }
  });

  it("refreshes daemon-owned session guardrails and exposes the snapshot in status", async () => {
    const createRes = await fetchWithToken(port, "/sessions", { method: "POST" });
    const { session_id } = await createRes.json() as { session_id: string };

    const beforeStatusRes = await fetchWithToken(port, "/status");
    const beforeStatus = await beforeStatusRes.json() as {
      sessions: Array<{ id: string; guardrailsSnapshot?: { id: string; generation: number } }>;
    };
    const beforeSnapshot = beforeStatus.sessions.find((s) => s.id === session_id)?.guardrailsSnapshot;
    expect(beforeSnapshot?.generation).toBe(0);

    const summary = server.refreshChatSessionGuardrails({
      policies: { safe: "allow", moderate: "allow", dangerous: "deny" },
    });
    expect(summary).toEqual({ refreshed: 1, unchanged: 0 });

    const afterStatusRes = await fetchWithToken(port, "/status");
    const afterStatus = await afterStatusRes.json() as {
      sessions: Array<{ id: string; guardrailsSnapshot?: { id: string; generation: number } }>;
    };
    const afterSnapshot = afterStatus.sessions.find((s) => s.id === session_id)?.guardrailsSnapshot;
    expect(afterSnapshot?.generation).toBe(1);
    expect(afterSnapshot?.id).not.toBe(beforeSnapshot?.id);

    const unchanged = server.refreshChatSessionGuardrails({
      policies: { safe: "allow", moderate: "allow", dangerous: "deny" },
    });
    expect(unchanged).toEqual({ refreshed: 0, unchanged: 1 });

    const finalStatusRes = await fetchWithToken(port, "/status");
    const finalStatus = await finalStatusRes.json() as {
      sessions: Array<{ id: string; guardrailsSnapshot?: { id: string; generation: number } }>;
    };
    const finalSnapshot = finalStatus.sessions.find((s) => s.id === session_id)?.guardrailsSnapshot;
    expect(finalSnapshot).toEqual(afterSnapshot);
  });

  it("DELETE /sessions/:id closes daemon session", async () => {
    const createRes = await fetchWithToken(port, "/sessions", { method: "POST" });
    const { session_id } = await createRes.json() as { session_id: string };
    const deleteRes = await fetchWithToken(port, `/sessions/${session_id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(204);
  });

  it("DELETE /sessions/:id aborts an in-flight daemon chat request", async () => {
    const agent = mockAgentSession(undefined, "supervised");
    let rejectSend: ((err: Error) => void) | undefined;
    agent.send.mockImplementation(async () =>
      new Promise((_resolve, reject) => {
        rejectSend = reject;
      })
    );
    agent.close.mockImplementation(() => {
      rejectSend?.(new Error("Session closed"));
    });
    const cancelBindingsDir = mkdtempSync(join(tmpdir(), "kota-chat-cancel-"));
    const cancelServer = new DaemonControlServer(makeHandle(), TEST_TOKEN, {
      makeAgent: () => agent as never,
      defaultAutonomyMode: "supervised",
      chatBindings: new DaemonChatBindingStore(cancelBindingsDir),
      conversationResolver: makeResolver(new Set()),
    });
    const cancelPort = await cancelServer.start();
    try {
      const createRes = await fetchWithToken(cancelPort, "/sessions", { method: "POST" });
      const { session_id } = await createRes.json() as { session_id: string };
      const chatRes = await fetchWithToken(cancelPort, `/sessions/${session_id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "wait" }),
      });
      expect(chatRes.status).toBe(200);
      await vi.waitFor(() => expect(agent.send).toHaveBeenCalledTimes(1));

      const deleteRes = await fetchWithToken(cancelPort, `/sessions/${session_id}`, { method: "DELETE" });
      expect(deleteRes.status).toBe(204);

      const text = await chatRes.text();
      expect(agent.close).toHaveBeenCalledTimes(1);
      expect(text).toContain("event: error");
      expect(text).toContain("Session closed");
    } finally {
      await cancelServer.stop();
      rmSync(cancelBindingsDir, { recursive: true, force: true });
    }
  });

  it("POST /sessions/:id/cancel aborts an in-flight turn without deleting the session", async () => {
    const agent = mockAgentSession("after cancel", "supervised");
    let rejectSend: ((err: Error) => void) | undefined;
    let sendCount = 0;
    agent.send.mockImplementation(async () => {
      sendCount++;
      if (sendCount === 1) {
        return await new Promise((_resolve, reject) => {
          rejectSend = reject;
        });
      }
      return "after cancel";
    });
    agent.cancelActiveTurn.mockImplementation(() => {
      rejectSend?.(new Error("Session cancelled"));
    });
    const cancelBindingsDir = mkdtempSync(join(tmpdir(), "kota-chat-turn-cancel-"));
    const cancelServer = new DaemonControlServer(makeHandle(), TEST_TOKEN, {
      makeAgent: () => agent as never,
      defaultAutonomyMode: "supervised",
      chatBindings: new DaemonChatBindingStore(cancelBindingsDir),
      conversationResolver: makeResolver(new Set()),
    });
    const cancelPort = await cancelServer.start();
    try {
      const createRes = await fetchWithToken(cancelPort, "/sessions", { method: "POST" });
      const { session_id } = await createRes.json() as { session_id: string };
      const chatRes = await fetchWithToken(cancelPort, `/sessions/${session_id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "wait" }),
      });
      expect(chatRes.status).toBe(200);
      await vi.waitFor(() => expect(agent.send).toHaveBeenCalledTimes(1));

      const cancelRes = await fetchWithToken(cancelPort, `/sessions/${session_id}/cancel`, {
        method: "POST",
      });
      expect(cancelRes.status).toBe(204);
      const cancelledText = await chatRes.text();
      expect(agent.cancelActiveTurn).toHaveBeenCalledTimes(1);
      expect(cancelledText).toContain("event: error");
      expect(cancelledText).toContain("Session cancelled");

      const followupRes = await fetchWithToken(cancelPort, `/sessions/${session_id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "next" }),
      });
      expect(followupRes.status).toBe(200);
      const followupText = await followupRes.text();
      expect(followupText).toContain("event: done");
      expect(followupText).toContain("after cancel");
      expect(agent.close).not.toHaveBeenCalled();
    } finally {
      await cancelServer.stop();
      rmSync(cancelBindingsDir, { recursive: true, force: true });
    }
  });

  it("DELETE /sessions/:id returns 204 for known serve sessions via unregister", async () => {
    // Serve sessions: unregister always returns 204 (the handle unregister does)
    const res = await fetchWithToken(port, "/sessions/serve-session-id", { method: "DELETE" });
    // unregisterSession just removes from map and emits — returns 204
    expect(res.status).toBe(204);
  });

  it("POST /sessions/:id/chat returns 404 for unknown session", async () => {
    const res = await fetchWithToken(port, "/sessions/unknown/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    expect(res.status).toBe(404);
  });

  it("PATCH /sessions/:id updates the mode of a daemon-owned session", async () => {
    const createRes = await fetchWithToken(port, "/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autonomy_mode: "supervised" }),
    });
    const { session_id } = await createRes.json() as { session_id: string };
    const patchRes = await fetchWithToken(port, `/sessions/${session_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autonomy_mode: "autonomous" }),
    });
    expect(patchRes.status).toBe(200);
    const body = await patchRes.json() as { source: string; autonomy_mode: string };
    expect(body.source).toBe("daemon");
    expect(body.autonomy_mode).toBe("autonomous");

    const listRes = await fetchWithToken(port, "/sessions");
    const listBody = await listRes.json() as { sessions: Array<{ id: string; autonomyMode: string }> };
    const entry = listBody.sessions.find((s) => s.id === session_id);
    expect(entry?.autonomyMode).toBe("autonomous");
  });

  it("PATCH /sessions/:id returns 400 on invalid mode", async () => {
    const createRes = await fetchWithToken(port, "/sessions", { method: "POST" });
    const { session_id } = await createRes.json() as { session_id: string };
    const res = await fetchWithToken(port, `/sessions/${session_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autonomy_mode: "banana" }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /sessions/:id reports serve source when daemon only holds registration metadata", async () => {
    let currentMode: "passive" | "supervised" | "autonomous" = "supervised";
    const serveHandle = makeHandle({
      setSessionAutonomyMode: vi.fn((_id, mode) => {
        currentMode = mode;
        return { ok: true, serveOwned: true };
      }),
    });
    const serveServer = new DaemonControlServer(serveHandle, TEST_TOKEN, {
      makeAgent: (_transport, mode) => mockAgentSession({ result: "ok" }, mode) as never,
      defaultAutonomyMode: "supervised",
      chatBindings: makeBindingStore(),
      conversationResolver: makeResolver(new Set()),
    });
    const servePort = await serveServer.start();
    try {
      const res = await globalThis.fetch(`http://127.0.0.1:${servePort}/sessions/serve-abc`, {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${TEST_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ autonomy_mode: "passive" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { source: string; autonomy_mode: string; serveOwned: boolean };
      expect(body.source).toBe("serve");
      expect(body.serveOwned).toBe(true);
      expect(body.autonomy_mode).toBe("passive");
      expect(currentMode).toBe("passive");
    } finally {
      await serveServer.stop();
    }
  });

  it("PATCH /sessions/:id returns 404 when session is unknown", async () => {
    const res = await fetchWithToken(port, "/sessions/unknown-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autonomy_mode: "passive" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("Daemon chat project-scoped history", () => {
  let rootDir: string;
  let stateDir: string;
  let defaultProjectDir: string;
  let selectedProjectDir: string;

  beforeEach(() => {
    resetEventBus();
    resetScheduler();
    resetProviderRegistry();
    rootDir = mkdtempSync(join(tmpdir(), "kota-chat-project-history-"));
    stateDir = join(rootDir, "daemon-state");
    defaultProjectDir = join(rootDir, "project-default");
    selectedProjectDir = join(rootDir, "project-selected");
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(defaultProjectDir, { recursive: true });
    mkdirSync(selectedProjectDir, { recursive: true });
  });

  afterEach(() => {
    resetEventBus();
    resetScheduler();
    resetProviderRegistry();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("creates POST /sessions conversations in the selected project's history store", async () => {
    installMockModelClient();
    const registry = initProviderRegistry();
    const historyProviders = new Map<string, HistoryProvider>();
    const historyForProject = (projectDir: string): HistoryProvider => {
      const existing = historyProviders.get(projectDir);
      if (existing) return existing;
      const provider = makeFileHistoryProvider(projectDir);
      historyProviders.set(projectDir, provider);
      return provider;
    };
    registry.register(
      HISTORY_PROVIDER_TOKEN,
      "test-history",
      historyForProject(defaultProjectDir),
    );
    registry.register(HISTORY_PROJECT_PROVIDER_TOKEN, "test-history", {
      forProject: (project) => historyForProject(project.projectDir),
    });

    const config = { defaultAgentHarness: "claude-agent-sdk", reflection: false };
    const daemon = new Daemon({
      projects: [{ projectDir: defaultProjectDir }, { projectDir: selectedProjectDir }],
      stateDir,
      idleIntervalMs: 60_000,
      pollIntervalMs: 60_000,
      workflows: [],
      channels: [],
      config,
    });
    const startPromise = daemon.start();
    try {
      await vi.waitFor(() => {
        expect(existsSync(join(stateDir, "daemon-control.json"))).toBe(true);
      });
      const address = readDaemonControlAddress(stateDir);
      const selectedProjectId = deriveProjectId(selectedProjectDir);

      const createRes = await fetchWithDaemonToken(
        address.port,
        address.token,
        `/sessions?projectId=${selectedProjectId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ autonomy_mode: "supervised" }),
        },
      );
      expect(createRes.status).toBe(201);
      const created = await createRes.json() as {
        session_id: string;
        conversation_id: string;
        project_id: string;
      };
      expect(created.project_id).toBe(selectedProjectId);

      const chatRes = await fetchWithDaemonToken(
        address.port,
        address.token,
        `/sessions/${created.session_id}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "hello" }),
        },
      );
      expect(chatRes.status).toBe(200);
      const chatText = await chatRes.text();
      expect(chatText).toContain("daemon reply");
      expect(chatText).not.toContain(`Conversation ${created.conversation_id} not found`);

      const selectedHistoryPath = join(
        selectedProjectDir,
        ".kota",
        "history",
        `${created.conversation_id}.json`,
      );
      const defaultHistoryPath = join(
        defaultProjectDir,
        ".kota",
        "history",
        `${created.conversation_id}.json`,
      );
      expect(existsSync(selectedHistoryPath)).toBe(true);
      expect(existsSync(defaultHistoryPath)).toBe(false);
    } finally {
      await daemon.stop();
      await startPromise;
    }
  });
});

// --- Integration: server-level defaultAutonomyMode knob ---

describe("DaemonControlServer defaultAutonomyMode knob", () => {
  it("uses the configured default when POST /sessions omits autonomy_mode", async () => {
    const handle = makeHandle();
    const server = new DaemonControlServer(handle, TEST_TOKEN, {
      makeAgent: (_transport, mode) => mockAgentSession({ result: "ok" }, mode) as never,
      defaultAutonomyMode: "passive",
      chatBindings: makeBindingStore(),
      conversationResolver: makeResolver(new Set()),
    });
    const port = await server.start();
    try {
      const createRes = await fetchWithToken(port, "/sessions", { method: "POST" });
      expect(createRes.status).toBe(201);
      const createBody = await createRes.json() as { session_id: string; autonomy_mode: string };
      expect(createBody.autonomy_mode).toBe("passive");

      const listRes = await fetchWithToken(port, "/sessions");
      const listBody = await listRes.json() as { sessions: Array<{ id: string; autonomyMode: string }> };
      const entry = listBody.sessions.find((s) => s.id === createBody.session_id);
      expect(entry?.autonomyMode).toBe("passive");
    } finally {
      await server.stop();
    }
  });
});

// --- Wake-after-restart: the task's defining use case ---

describe("DaemonControlServer wake after daemon restart", () => {
  it("accepts POST /sessions with prior session_id backed by the persisted binding", async () => {
    const bindingsDir = mkdtempSync(join(tmpdir(), "kota-chat-restart-"));
    try {
      // First daemon boot: create a session, remember its id + conv.
      const conversations = new Set<string>();
      const resolver1 = makeResolver(conversations);
      const server1 = new DaemonControlServer(makeHandle(), TEST_TOKEN, {
        makeAgent: (_transport, mode) => mockAgentSession({ result: "ok" }, mode) as never,
        defaultAutonomyMode: "supervised",
        chatBindings: new DaemonChatBindingStore(bindingsDir),
        conversationResolver: resolver1,
      });
      const port1 = await server1.start();
      const createRes = await fetchWithToken(port1, "/sessions", { method: "POST" });
      expect(createRes.status).toBe(201);
      const created = await createRes.json() as { session_id: string; conversation_id: string };
      await server1.stop();

      // Second daemon boot: brand new server, new binding-store instance, same file.
      const resumedResumes: Array<string | undefined> = [];
      const server2 = new DaemonControlServer(makeHandle(), TEST_TOKEN, {
        makeAgent: (_transport, mode, resumeConv) => {
          resumedResumes.push(resumeConv);
          return mockAgentSession({ result: "ok" }, mode) as never;
        },
        defaultAutonomyMode: "supervised",
        chatBindings: new DaemonChatBindingStore(bindingsDir),
        conversationResolver: makeResolver(conversations),
      });
      const port2 = await server2.start();
      try {
        const wakeRes = await fetchWithToken(port2, "/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: created.session_id }),
        });
        expect(wakeRes.status).toBe(201);
        const woken = await wakeRes.json() as { session_id: string; conversation_id: string };
        expect(woken.session_id).toBe(created.session_id);
        expect(woken.conversation_id).toBe(created.conversation_id);
        expect(resumedResumes).toEqual([created.conversation_id]);
      } finally {
        await server2.stop();
      }
    } finally {
      rmSync(bindingsDir, { recursive: true, force: true });
    }
  });

  it("returns 404 when waking an unknown session_id", async () => {
    const bindingsDir = mkdtempSync(join(tmpdir(), "kota-chat-404-"));
    try {
      const server = new DaemonControlServer(makeHandle(), TEST_TOKEN, {
        makeAgent: (_transport, mode) => mockAgentSession({ result: "ok" }, mode) as never,
        defaultAutonomyMode: "supervised",
        chatBindings: new DaemonChatBindingStore(bindingsDir),
        conversationResolver: makeResolver(new Set()),
      });
      const port = await server.start();
      try {
        const res = await fetchWithToken(port, "/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: "never-existed" }),
        });
        expect(res.status).toBe(404);
      } finally {
        await server.stop();
      }
    } finally {
      rmSync(bindingsDir, { recursive: true, force: true });
    }
  });

  it("DELETE /sessions/:id clears the binding so subsequent wake attempts 404", async () => {
    const bindingsDir = mkdtempSync(join(tmpdir(), "kota-chat-del-"));
    try {
      const conversations = new Set<string>();
      const server = new DaemonControlServer(makeHandle(), TEST_TOKEN, {
        makeAgent: (_transport, mode) => mockAgentSession({ result: "ok" }, mode) as never,
        defaultAutonomyMode: "supervised",
        chatBindings: new DaemonChatBindingStore(bindingsDir),
        conversationResolver: makeResolver(conversations),
      });
      const port = await server.start();
      try {
        const createRes = await fetchWithToken(port, "/sessions", { method: "POST" });
        const created = await createRes.json() as { session_id: string };
        const delRes = await fetchWithToken(port, `/sessions/${created.session_id}`, { method: "DELETE" });
        expect(delRes.status).toBe(204);
        const wakeRes = await fetchWithToken(port, "/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: created.session_id }),
        });
        expect(wakeRes.status).toBe(404);
      } finally {
        await server.stop();
      }
    } finally {
      rmSync(bindingsDir, { recursive: true, force: true });
    }
  });
});
