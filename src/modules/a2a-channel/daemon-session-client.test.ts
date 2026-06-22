import { describe, expect, it, vi } from "vitest";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { DaemonA2ABackend } from "./daemon-session-client.js";
import { NOW } from "./routes-test-support.js";

describe("DaemonA2ABackend", () => {
  it("maps daemon SSE output to sanitized A2A artifacts and guardrail status updates", async () => {
    const updates: unknown[] = [];
    const transport = makeDaemonTransport();
    const backend = new DaemonA2ABackend(transport, () => NOW);

    const task = await backend.sendMessage(
      { taskId: null, contextId: null, projectId: "proj-1", text: "hello" },
      { onUpdate: (update) => updates.push(update) },
    );

    expect(task.id).toBe("sess-1");
    expect(task.artifacts[0]?.parts[0]?.text).toBe("final answer");
    expect(updates.some((update) => typeof update === "object" && update !== null && "artifactUpdate" in update)).toBe(true);
    expect(JSON.stringify(updates)).not.toContain("private reasoning");
    expect(JSON.stringify(updates)).toContain("KOTA guardrail applied");
    const createCall = vi.mocked(transport.fetchRaw).mock.calls.find(([path, init]) =>
      path === "/sessions?projectId=proj-1" && init?.method === "POST"
    );
    expect(createCall).toBeDefined();
    expect(createCall?.[1]).not.toHaveProperty("body");
  });

  it("creates context-only SendMessage sessions without daemon project scope", async () => {
    const transport = makeDaemonTransport();
    const backend = new DaemonA2ABackend(transport, () => NOW);

    const task = await backend.sendMessage({
      taskId: null,
      contextId: "client-context",
      projectId: null,
      text: "hello",
    });

    expect(task.id).toBe("sess-unscoped");
    expect(task.contextId).toBe("client-context");
    expect(task.artifacts[0]?.parts[0]?.text).toBe("unscoped final");
    const calledPaths = vi.mocked(transport.fetchRaw).mock.calls.map(([path]) => path);
    expect(calledPaths).toContain("/sessions");
    expect(calledPaths).not.toContain("/sessions?projectId=client-context");
  });

  it("subscribes to active daemon session output and emits artifact updates", async () => {
    const updates: unknown[] = [];
    const backend = new DaemonA2ABackend(makeDaemonTransport(), () => NOW);

    const task = await backend.subscribeToTask(
      { taskId: "active-task", projectId: null, contextId: null },
      { onUpdate: (update) => updates.push(update) },
    );

    expect(task.id).toBe("active-task");
    expect(task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(task.artifacts[0]?.parts[0]?.text).toBe("subscribed final");
    expect(updates.some((update) => typeof update === "object" && update !== null && "artifactUpdate" in update)).toBe(true);
    expect(updates[0]).toHaveProperty("task.id", "active-task");
  });

  it("keeps context-only daemon list and get calls on the unscoped session route", async () => {
    const transport = makeScopedDaemonTransport();
    const backend = new DaemonA2ABackend(transport, () => NOW);

    const listed = await backend.listTasks({ projectId: null, contextId: "proj-2" });
    expect(listed).toEqual([]);

    await expect(
      backend.getTask({ taskId: "task-2", projectId: null, contextId: "proj-2" }),
    ).rejects.toMatchObject({ message: "A2A task not found: task-2" });

    const calledPaths = vi.mocked(transport.fetchRaw).mock.calls.map(([path]) => path);
    expect(calledPaths).toContain("/sessions");
    expect(calledPaths).not.toContain("/sessions?projectId=proj-2");
  });

  it("filters daemon-backed list and get calls by normalized project scope", async () => {
    const transport = makeScopedDaemonTransport();
    const backend = new DaemonA2ABackend(transport, () => NOW);

    const listed = await backend.listTasks({ projectId: "proj-2", contextId: null });
    expect(listed.map((task) => task.id)).toEqual(["task-2"]);
    expect(listed[0]?.contextId).toBe("proj-2");

    const found = await backend.getTask({ taskId: "task-2", projectId: "proj-2", contextId: null });
    expect(found.id).toBe("task-2");
    expect(found.contextId).toBe("proj-2");

    await expect(
      backend.getTask({ taskId: "task-2", projectId: "proj-2", contextId: "proj-1" }),
    ).rejects.toMatchObject({ message: "A2A task not found: task-2" });

    const calledPaths = vi.mocked(transport.fetchRaw).mock.calls.map(([path]) => path);
    expect(calledPaths).toContain("/sessions?projectId=proj-2");
  });

  it("validates resumed SendMessage tasks against A2A scope before chat", async () => {
    const transport = makeScopedDaemonTransport();
    const backend = new DaemonA2ABackend(transport, () => NOW);

    await expect(
      backend.sendMessage({ taskId: "task-2", projectId: "proj-2", contextId: "proj-1", text: "hello" }),
    ).rejects.toMatchObject({ message: "A2A task not found: task-2" });
    expect(vi.mocked(transport.fetchRaw).mock.calls.map(([path]) => path)).not.toContain(
      "/sessions/task-2/chat",
    );

    const task = await backend.sendMessage({ taskId: "task-2", projectId: "proj-2", contextId: null, text: "hello" });
    expect(task.id).toBe("task-2");
    expect(task.contextId).toBe("proj-2");
    expect(task.artifacts[0]?.parts[0]?.text).toBe("resumed final");
    expect(task.history.map((message) => message.contextId)).toEqual(["proj-2", "proj-2"]);
    expect(vi.mocked(transport.fetchRaw).mock.calls.map(([path]) => path)).toContain("/sessions/task-2/chat");
  });
});

function makeDaemonTransport(): DaemonTransport {
  const fetchRaw = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/sessions?projectId=proj-1" && init?.method === "POST") {
      return jsonResponse({ session_id: "sess-1", project_id: "proj-1" });
    }
    if (path === "/sessions" && init?.method === "POST") {
      return jsonResponse({ session_id: "sess-unscoped" });
    }
    if (path === "/sessions" && init?.method === "GET") {
      return jsonResponse({
        sessions: [
          {
            id: "active-task",
            createdAt: NOW,
            lastActive: 1,
            busy: true,
            autonomyMode: "supervised",
            source: "daemon",
            projectId: "proj-1",
            conversationId: "conv-1",
          },
        ],
      });
    }
    if (path === "/sessions/sess-1/chat") {
      return sseResponse([
        "event: thinking\n",
        "data: {\"content\":\"private reasoning\"}\n\n",
        "event: guardrail\n",
        "data: {\"policy\":\"approval\",\"risk\":\"write\"}\n\n",
        "event: text\n",
        "data: {\"content\":\"partial\"}\n\n",
        "event: done\n",
        "data: {\"session_id\":\"sess-1\",\"result\":\"final answer\"}\n\n",
      ]);
    }
    if (path === "/sessions/sess-unscoped/chat") {
      return sseResponse([
        "event: text\n",
        "data: {\"content\":\"unscoped partial\"}\n\n",
        "event: done\n",
        "data: {\"session_id\":\"sess-unscoped\",\"result\":\"unscoped final\"}\n\n",
      ]);
    }
    if (path === "/sessions/active-task/events") {
      return sseResponse([
        "event: text\n",
        "data: {\"content\":\"subscribed partial\"}\n\n",
        "event: done\n",
        "data: {\"session_id\":\"active-task\",\"result\":\"subscribed final\"}\n\n",
      ]);
    }
    return jsonResponse({ error: `unexpected ${path}` }, 500);
  });
  return {
    baseUrl: "http://127.0.0.1:1234",
    authHeaders: () => ({ Authorization: "Bearer test" }),
    request: vi.fn(),
    requestStrict: vi.fn(),
    events: vi.fn(),
    fetchRaw,
  };
}

function makeScopedDaemonTransport(): DaemonTransport {
  const sessionsByProject: Record<string, object[]> = {
    "proj-1": [session("task-1", "proj-1", 1, false, "supervised", "daemon")],
    "proj-2": [
      session("task-2", "proj-2", 2, false, "autonomous", "daemon"),
      session("serve-task", "proj-2", 3, false, "supervised", "serve"),
    ],
  };
  const fetchRaw = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.startsWith("/sessions?") && init?.method === "GET") {
      const url = new URL(path, "http://127.0.0.1");
      return jsonResponse({ sessions: sessionsByProject[url.searchParams.get("projectId") ?? ""] ?? [] });
    }
    if (path === "/sessions" && init?.method === "GET") {
      return jsonResponse({ sessions: sessionsByProject["proj-1"] ?? [] });
    }
    if (path === "/sessions/task-2/chat" && init?.method === "POST") {
      return sseResponse([
        "event: text\n",
        "data: {\"content\":\"resumed partial\"}\n\n",
        "event: done\n",
        "data: {\"session_id\":\"task-2\",\"result\":\"resumed final\"}\n\n",
      ]);
    }
    return jsonResponse({ error: `unexpected ${path}` }, 500);
  });
  return {
    baseUrl: "http://127.0.0.1:1234",
    authHeaders: () => ({ Authorization: "Bearer test" }),
    request: vi.fn(),
    requestStrict: vi.fn(),
    events: vi.fn(),
    fetchRaw,
  };
}

function session(
  id: string,
  projectId: string,
  lastActive: number,
  busy: boolean,
  autonomyMode: string,
  source: string,
): object {
  return {
    id,
    createdAt: NOW,
    lastActive,
    busy,
    autonomyMode,
    source,
    projectId,
    conversationId: `conv-${id}`,
  };
}

function sseResponse(chunks: string[]): Response {
  return new Response(chunks.join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function jsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
