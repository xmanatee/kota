import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import type { DaemonChatConversationResolver } from "./daemon-chat-handlers.js";
import {
  type DaemonControlHandle,
  DaemonControlServer,
  type WorkflowLiveStatus,
  type WorkflowMetricCounts,
} from "./daemon-control.js";

const CONV_ID = "c-fixture-0000";

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
  return {
    send: vi.fn(async () => sendResult ?? { status: "ok" }),
    close: vi.fn(),
    getAutonomyMode: vi.fn(() => current),
    setAutonomyMode: vi.fn((next: "passive" | "supervised" | "autonomous") => { current = next; }),
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
    reloadConfig: vi.fn(async () => ({ workflows: 0, changedModules: [] as string[] })),
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
    const body = await res.json() as { sessions: Array<{ source: string }> };
    expect(body.sessions.some((s) => s.source === "daemon")).toBe(true);
  });

  it("DELETE /sessions/:id closes daemon session", async () => {
    const createRes = await fetchWithToken(port, "/sessions", { method: "POST" });
    const { session_id } = await createRes.json() as { session_id: string };
    const deleteRes = await fetchWithToken(port, `/sessions/${session_id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(204);
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
