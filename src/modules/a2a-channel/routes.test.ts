import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext, RouteRegistration } from "#core/modules/module-types.js";
import { findRouteMatch } from "#core/modules/route-matcher.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type { A2ABackend } from "./daemon-session-client.js";
import { DaemonA2ABackend, makeTask } from "./daemon-session-client.js";
import {
  A2A_EXTENDED_CARD_PATH,
  A2A_PROTOCOL_VERSION,
  A2A_RPC_PATH,
  A2A_SUPPORTED_PROTOCOL_VERSIONS,
  A2A_WELL_KNOWN_CARD_PATH,
  type A2ATask,
  type A2ATaskUpdate,
  type SendMessageInput,
  type TaskListFilter,
  type TaskSelector,
  taskNotFound,
  terminalTaskSubscription,
  unauthorized,
} from "./protocol.js";
import { a2aRoutes } from "./routes.js";

const NOW = "2026-05-27T05:44:30.913Z";

describe("a2a channel routes", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.map(closeServer));
    servers.length = 0;
  });

  it("returns a public Agent Card with cache headers and bearer-protected RPC metadata", async () => {
    const backend = new FakeBackend();
    const server = await startRouteServer(a2aRoutes(makeContext(), {
      backendFactory: () => backend,
    }));
    servers.push(server.server);

    const res = await fetch(`${server.baseUrl}${A2A_WELL_KNOWN_CARD_PATH}`, {
      headers: {
        "x-forwarded-host": new URL(server.baseUrl).host,
        "x-forwarded-proto": "http",
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const card = await res.json();
    expect(card).toMatchObject({
      name: "KOTA",
      supportedInterfaces: [
        {
          url: `${server.baseUrl}${A2A_RPC_PATH}`,
          protocolBinding: "JSONRPC",
          protocolVersion: A2A_PROTOCOL_VERSION,
        },
      ],
      capabilities: {
        streaming: true,
        pushNotifications: false,
        extendedAgentCard: true,
      },
      securitySchemes: {
        bearer: { httpAuthSecurityScheme: { scheme: "Bearer" } },
      },
      securityRequirements: [{ bearer: [] }],
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
    });
    expect(card.protocolVersion).toBeUndefined();
    expect(card.preferredTransport).toBeUndefined();
    expect(card.url).toBeUndefined();
    expect(card.skills.map((skill: { id: string }) => skill.id)).toContain("kota.session");

    const extended = await fetch(`${server.baseUrl}${A2A_EXTENDED_CARD_PATH}`);
    const unscopedExtended = await extended.json();
    expect(unscopedExtended.supportedInterfaces).toEqual(card.supportedInterfaces);
    expect(unscopedExtended.supportedInterfaces[0].tenant).toBeUndefined();

    const scopedExtended = await fetch(`${server.baseUrl}${A2A_EXTENDED_CARD_PATH}?projectId=proj-1`);
    expect(scopedExtended.headers.get("cache-control")).toBe("no-store");
    expect((await scopedExtended.json()).supportedInterfaces).toEqual([
      {
        url: `${server.baseUrl}${A2A_RPC_PATH}`,
        protocolBinding: "JSONRPC",
        protocolVersion: A2A_PROTOCOL_VERSION,
        tenant: "proj-1",
      },
    ]);
  });

  it("handles SendMessage, GetTask, ListTasks, and CancelTask through JSON-RPC", async () => {
    const backend = new FakeBackend();
    const server = await startRouteServer(a2aRoutes(makeContext(), {
      backendFactory: () => backend,
    }));
    servers.push(server.server);

    const send = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: 1,
      method: "SendMessage",
      params: {
        tenant: "proj-1",
        message: {
          role: "ROLE_USER",
          parts: [{ text: "ship the slice", mediaType: "text/plain" }],
          metadata: { projectId: "proj-1" },
        },
      },
    });
    expect(send.result.task.id).toBe("task-1");
    expect(send.result.task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(backend.sentInputs[0]).toMatchObject({
      projectId: "proj-1",
      text: "ship the slice",
    });

    await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: 11,
      method: "SendMessage",
      params: {
        message: {
          role: "ROLE_USER",
          parts: [{ text: "use the unscoped route", mediaType: "text/plain" }],
        },
      },
    });
    expect(backend.sentInputs[1]).toMatchObject({
      projectId: null,
      text: "use the unscoped route",
    });

    const get = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: 2,
      method: "GetTask",
      params: { id: "task-1", tenant: "proj-1" },
    });
    expect(get.result.status.state).toBe("TASK_STATE_COMPLETED");
    expect(backend.getSelectors[0]).toEqual({ taskId: "task-1", projectId: "proj-1", contextId: null });

    const list = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: 3,
      method: "ListTasks",
      params: { tenant: "proj-1" },
    });
    expect(list.result).toMatchObject({
      nextPageToken: "",
      pageSize: 1,
      totalSize: 1,
    });
    expect(list.result.tasks).toHaveLength(1);
    expect(backend.listFilters[0]).toEqual({ projectId: "proj-1", contextId: null });

    await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: 31,
      method: "ListTasks",
      params: { contextId: "proj-2" },
    });
    expect(backend.listFilters[1]).toEqual({ projectId: null, contextId: "proj-2" });

    const cancel = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: 4,
      method: "CancelTask",
      params: { id: "task-1", tenant: "proj-1", metadata: { projectId: "proj-1" } },
    });
    expect(cancel.result.status.state).toBe("TASK_STATE_CANCELED");
    expect(backend.cancelSelectors[0]).toEqual({ taskId: "task-1", projectId: "proj-1", contextId: null });
  });

  it("negotiates supported A2A v1.0 through the header and request parameter", async () => {
    const backend = new FakeBackend();
    const server = await startRouteServer(a2aRoutes(makeContext(), {
      backendFactory: () => backend,
    }));
    servers.push(server.server);

    const byHeader = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "version-header",
      method: "ListTasks",
      params: { projectId: "proj-1" },
    });
    expect(byHeader.result.tasks).toHaveLength(1);

    const byQuery = await postRpc(
      server.baseUrl,
      {
        jsonrpc: "2.0",
        id: "version-query",
        method: "ListTasks",
        params: { projectId: "proj-2" },
      },
      {
        includeDefaultVersion: false,
        query: `?${new URLSearchParams({ "A2A-Version": A2A_PROTOCOL_VERSION })}`,
      },
    );
    expect(byQuery.result.tasks).toHaveLength(1);
    expect(backend.listFilters).toEqual([
      { projectId: "proj-1", contextId: null },
      { projectId: "proj-2", contextId: null },
    ]);
  });

  it("rejects unsupported, missing, and empty A2A versions before daemon work starts", async () => {
    const backend = new FakeBackend();
    const backendFactory = vi.fn(() => backend);
    const server = await startRouteServer(a2aRoutes(makeContext(), {
      backendFactory,
    }));
    servers.push(server.server);

    for (const entry of [
      {
        id: "explicit-version",
        options: { headers: { "A2A-Version": "2.0" } },
        requestedVersion: "2.0",
      },
      {
        id: "missing-version",
        options: { includeDefaultVersion: false },
        requestedVersion: "0.3",
      },
      {
        id: "empty-version",
        options: { headers: { "A2A-Version": "" } },
        requestedVersion: "0.3",
      },
    ]) {
      const response = await postRpc(
        server.baseUrl,
        {
          jsonrpc: "2.0",
          id: entry.id,
          method: "SendMessage",
          params: sendMessageParams({ acceptedOutputModes: ["text/plain"] }),
        },
        entry.options,
      );
      expect(response.error.code).toBe(-32009);
      expect(errorReason(response)).toBe("VERSION_NOT_SUPPORTED");
      expect(errorMetadata(response)).toEqual({
        requestedVersion: entry.requestedVersion,
        supportedVersions: [...A2A_SUPPORTED_PROTOCOL_VERSIONS],
      });
      expect(response.id).toBe(entry.id);
    }

    expect(backendFactory).not.toHaveBeenCalled();
    expect(backend.sentInputs).toHaveLength(0);
  });

  it("rejects mismatched tenant and projectId routing before daemon work starts", async () => {
    const backend = new FakeBackend();
    const backendFactory = vi.fn(() => backend);
    const server = await startRouteServer(a2aRoutes(makeContext(), {
      backendFactory,
    }));
    servers.push(server.server);

    const send = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "tenant-mismatch-send",
      method: "SendMessage",
      params: {
        tenant: "proj-1",
        message: {
          role: "ROLE_USER",
          parts: [{ text: "ship the slice", mediaType: "text/plain" }],
          metadata: { projectId: "proj-2" },
        },
      },
    });
    expect(send.error.code).toBe(-32602);
    expect(errorReason(send)).toBe("ROUTING_SCOPE_MISMATCH");
    expect(errorMetadata(send)).toEqual({ tenant: "proj-1", projectId: "proj-2" });

    const list = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "tenant-mismatch-list",
      method: "ListTasks",
      params: { tenant: "proj-1", projectId: "proj-2" },
    });
    expect(errorReason(list)).toBe("ROUTING_SCOPE_MISMATCH");

    expect(backendFactory).not.toHaveBeenCalled();
    expect(backend.sentInputs).toHaveLength(0);
  });

  it("streams SendStreamingMessage status, artifact, final task, and JSON-RPC response as SSE", async () => {
    const backend = new FakeBackend();
    const server = await startRouteServer(a2aRoutes(makeContext(), {
      backendFactory: () => backend,
    }));
    servers.push(server.server);

    const res = await fetch(`${server.baseUrl}${A2A_RPC_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "A2A-Version": A2A_PROTOCOL_VERSION },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "stream-1",
        method: "SendStreamingMessage",
        params: {
          tenant: "proj-1",
          message: {
            role: "ROLE_USER",
            parts: [{ text: "stream it", mediaType: "text/plain" }],
            metadata: { projectId: "proj-1" },
          },
        },
      }),
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const frames = parseSseJsonRpcResponses(await res.text());
    expect(frames.map((frame) => frame.id)).toEqual(["stream-1", "stream-1", "stream-1"]);
    expect(frames[0]?.result.statusUpdate.status.state).toBe("TASK_STATE_WORKING");
    expect(frames[1]?.result.artifactUpdate.artifact.parts[0].text).toBe("partial");
    expect(frames[2]?.result.task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(backend.sentInputs[0]?.projectId).toBe("proj-1");
  });

  it("emits one SSE version error for streaming version mismatches before backend work", async () => {
    const backend = new FakeBackend();
    const backendFactory = vi.fn(() => backend);
    const server = await startRouteServer(a2aRoutes(makeContext(), {
      backendFactory,
    }));
    servers.push(server.server);

    for (const request of [
      {
        id: "stream-version",
        method: "SendStreamingMessage",
        params: sendMessageParams({ acceptedOutputModes: ["text/plain"] }),
      },
      {
        id: "subscribe-version",
        method: "SubscribeToTask",
        params: { id: "task-1" },
      },
    ]) {
      const res = await fetch(`${server.baseUrl}${A2A_RPC_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "A2A-Version": "2.0" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          method: request.method,
          params: request.params,
        }),
      });
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const frames = parseSseJsonRpcResponses(await res.text());
      expect(frames).toHaveLength(1);
      expect(frames[0]?.id).toBe(request.id);
      expect(frames[0]?.error.code).toBe(-32009);
      expect(errorReason(frames[0])).toBe("VERSION_NOT_SUPPORTED");
      expect(errorMetadata(frames[0])).toEqual({
        requestedVersion: "2.0",
        supportedVersions: [...A2A_SUPPORTED_PROTOCOL_VERSIONS],
      });
    }

    expect(backendFactory).not.toHaveBeenCalled();
    expect(backend.sentInputs).toHaveLength(0);
  });

  it("emits one SSE routing error for streaming tenant mismatches before backend work", async () => {
    const backend = new FakeBackend();
    const backendFactory = vi.fn(() => backend);
    const server = await startRouteServer(a2aRoutes(makeContext(), {
      backendFactory,
    }));
    servers.push(server.server);

    for (const request of [
      {
        id: "stream-routing",
        method: "SendStreamingMessage",
        params: {
          tenant: "proj-1",
          message: {
            role: "ROLE_USER",
            parts: [{ text: "stream it", mediaType: "text/plain" }],
            metadata: { projectId: "proj-2" },
          },
        },
      },
      {
        id: "subscribe-routing",
        method: "SubscribeToTask",
        params: { id: "task-1", tenant: "proj-1", projectId: "proj-2" },
      },
    ]) {
      const res = await fetch(`${server.baseUrl}${A2A_RPC_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "A2A-Version": A2A_PROTOCOL_VERSION },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          method: request.method,
          params: request.params,
        }),
      });
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const frames = parseSseJsonRpcResponses(await res.text());
      expect(frames).toHaveLength(1);
      expect(frames[0]?.id).toBe(request.id);
      expect(frames[0]?.error.code).toBe(-32602);
      expect(errorReason(frames[0])).toBe("ROUTING_SCOPE_MISMATCH");
    }

    expect(backendFactory).not.toHaveBeenCalled();
    expect(backend.sentInputs).toHaveLength(0);
  });

  it("returns typed JSON-RPC errors for unsupported methods, bad parts, unknown tasks, terminal subscriptions, and unauthorized access", async () => {
    const backend = new FakeBackend();
    const server = await startRouteServer(a2aRoutes(makeContext(), {
      backendFactory: () => backend,
    }));
    servers.push(server.server);

    const unsupported = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: 1,
      method: "NotA2A",
      params: {},
    });
    expect(errorReason(unsupported)).toBe("METHOD_NOT_FOUND");
    expect(backend.sentInputs).toHaveLength(0);

    const badPart = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: 2,
      method: "SendMessage",
      params: {
        message: {
          role: "ROLE_USER",
          parts: [{ url: "file:///tmp/x", mediaType: "text/plain" }],
        },
      },
    });
    expect(errorReason(badPart)).toBe("CONTENT_TYPE_NOT_SUPPORTED");

    const unknown = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: 3,
      method: "GetTask",
      params: { id: "missing" },
    });
    expect(errorReason(unknown)).toBe("TASK_NOT_FOUND");

    const terminal = await fetch(`${server.baseUrl}${A2A_RPC_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "A2A-Version": A2A_PROTOCOL_VERSION },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "SubscribeToTask",
        params: { id: "task-1", tenant: "proj-1" },
      }),
    });
    const terminalFrames = parseSseJsonRpcResponses(await terminal.text());
    expect(errorReason(terminalFrames[0])).toBe("UNSUPPORTED_OPERATION");
    expect(backend.subscribeSelectors[0]).toEqual({ taskId: "task-1", projectId: "proj-1", contextId: null });

    backend.failUnauthorized = true;
    const denied = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: 5,
      method: "ListTasks",
      params: {},
    });
    expect(errorReason(denied)).toBe("UNAUTHORIZED");
  });

  it("returns typed JSON-RPC UNAUTHORIZED when host auth rejects the protected RPC route", async () => {
    const backend = new FakeBackend();
    const backendFactory = vi.fn(() => backend);
    const server = await startRouteServer(a2aRoutes(makeContext(), {
      backendFactory,
    }), { authToken: "secret-token" });
    servers.push(server.server);

    const denied = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "unauthorized-rpc",
      method: "SendMessage",
      params: sendMessageParams({ acceptedOutputModes: ["text/plain"] }),
    });

    expect(errorReason(denied)).toBe("UNAUTHORIZED");
    expect(denied.id).toBe("unauthorized-rpc");
    expect(backendFactory).not.toHaveBeenCalled();
    expect(backend.sentInputs).toHaveLength(0);
  });

  it("rejects unsupported send configuration before daemon work starts", async () => {
    const backend = new FakeBackend();
    const backendFactory = vi.fn(() => backend);
    const server = await startRouteServer(a2aRoutes(makeContext(), {
      backendFactory,
    }));
    servers.push(server.server);

    for (const configuration of [
      { taskPushNotificationConfig: { pushNotificationConfig: { url: "https://example.test/a2a" } } },
      { returnImmediately: true },
      { acceptedOutputModes: ["application/json"] },
    ]) {
      const res = await postRpc(server.baseUrl, {
        jsonrpc: "2.0",
        id: "send-config",
        method: "SendMessage",
        params: sendMessageParams(configuration),
      });
      expect(errorReason(res)).toBe("UNSUPPORTED_OPERATION");
      expect(backendFactory).not.toHaveBeenCalled();
      expect(backend.sentInputs).toHaveLength(0);
    }

    const unsupportedTextMedia = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "send-media-type",
      method: "SendMessage",
      params: {
        message: {
          role: "ROLE_USER",
          parts: [{ text: "ship the slice", mediaType: "text/markdown" }],
        },
      },
    });
    expect(errorReason(unsupportedTextMedia)).toBe("CONTENT_TYPE_NOT_SUPPORTED");
    expect(backendFactory).not.toHaveBeenCalled();
    expect(backend.sentInputs).toHaveLength(0);

    for (const configuration of [
      { taskPushNotificationConfig: { pushNotificationConfig: { url: "https://example.test/a2a" } } },
      { returnImmediately: true },
      { acceptedOutputModes: ["application/json"] },
    ]) {
      const streaming = await fetch(`${server.baseUrl}${A2A_RPC_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "A2A-Version": A2A_PROTOCOL_VERSION },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "stream-config",
          method: "SendStreamingMessage",
          params: sendMessageParams(configuration),
        }),
      });
      const frames = parseSseJsonRpcResponses(await streaming.text());
      expect(errorReason(frames[0])).toBe("UNSUPPORTED_OPERATION");
      expect(backendFactory).not.toHaveBeenCalled();
      expect(backend.sentInputs).toHaveLength(0);
    }
  });

  it("maps daemon SSE output to sanitized A2A artifacts and guardrail status updates", async () => {
    const updates: A2ATaskUpdate[] = [];
    const transport = makeDaemonTransport();
    const backend = new DaemonA2ABackend(transport, () => NOW);

    const task = await backend.sendMessage(
      { taskId: null, contextId: null, projectId: "proj-1", text: "hello" },
      { onUpdate: (update) => updates.push(update) },
    );

    expect(task.id).toBe("sess-1");
    expect(task.artifacts[0]?.parts[0]?.text).toBe("final answer");
    expect(updates.some((update) => "artifactUpdate" in update)).toBe(true);
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
    const updates: A2ATaskUpdate[] = [];
    const backend = new DaemonA2ABackend(makeDaemonTransport(), () => NOW);

    const task = await backend.subscribeToTask(
      { taskId: "active-task", projectId: null, contextId: null },
      { onUpdate: (update) => updates.push(update) },
    );

    expect(task.id).toBe("active-task");
    expect(task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(task.artifacts[0]?.parts[0]?.text).toBe("subscribed final");
    expect(updates.some((update) => "artifactUpdate" in update)).toBe(true);
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

class FakeBackend implements A2ABackend {
  sentInputs: SendMessageInput[] = [];
  getSelectors: TaskSelector[] = [];
  listFilters: TaskListFilter[] = [];
  cancelSelectors: TaskSelector[] = [];
  subscribeSelectors: TaskSelector[] = [];
  failUnauthorized = false;

  async sendMessage(
    input: SendMessageInput,
    options?: {
      signal?: AbortSignal;
      onUpdate?: (update: A2ATaskUpdate) => void;
    },
  ): Promise<A2ATask> {
    this.sentInputs.push(input);
    const taskId = input.taskId ?? "task-1";
    const contextId = input.contextId ?? input.projectId ?? taskId;
    const working = task(taskId, contextId, "TASK_STATE_WORKING", "working");
    options?.onUpdate?.({
      statusUpdate: {
        taskId,
        contextId,
        status: working.status,
        metadata: working.metadata,
      },
    });
    options?.onUpdate?.({
      artifactUpdate: {
        taskId,
        contextId,
        artifact: {
          artifactId: `${taskId}-response`,
          name: "KOTA response",
          parts: [{ text: "partial", mediaType: "text/plain" }],
        },
      },
    });
    const final = task(taskId, contextId, "TASK_STATE_COMPLETED", "done");
    options?.onUpdate?.({ task: final });
    return final;
  }

  async getTask(selector: TaskSelector): Promise<A2ATask> {
    this.getSelectors.push(selector);
    if (selector.taskId !== "task-1") throw taskNotFound(selector.taskId);
    return task("task-1", "proj-1", "TASK_STATE_COMPLETED", "done");
  }

  async listTasks(filter: TaskListFilter): Promise<A2ATask[]> {
    if (this.failUnauthorized) throw unauthorized();
    this.listFilters.push(filter);
    return [task("task-1", filter.contextId ?? filter.projectId ?? "proj-1", "TASK_STATE_COMPLETED", "done")];
  }

  async cancelTask(selector: TaskSelector): Promise<A2ATask> {
    this.cancelSelectors.push(selector);
    return task(selector.taskId, "proj-1", "TASK_STATE_CANCELED", "canceled");
  }

  async subscribeToTask(selector: TaskSelector): Promise<A2ATask> {
    this.subscribeSelectors.push(selector);
    throw terminalTaskSubscription(selector.taskId);
  }
}

function task(
  id: string,
  contextId: string,
  state: A2ATask["status"]["state"],
  message: string,
): A2ATask {
  return makeTask({
    id,
    contextId,
    state,
    messageText: message,
    metadata: { kotaSessionId: id },
    now: () => NOW,
  });
}

function makeContext(): ModuleContext {
  return {
    cwd: process.cwd(),
    verbose: false,
    config: {},
    storage: {} as never,
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    getSecret: vi.fn(),
    getModuleConfig: vi.fn(),
    getRegisteredConfigKeys: () => new Set(),
    getRoutes: () => [],
    getContributedControlRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
    getModuleSummaries: () => [
      {
        name: "example",
        source: "project",
        dependencies: [],
        toolNames: [],
        workflowNames: [],
        channelNames: [],
        skillNames: ["builder"],
        agentNames: [],
        agents: [],
        skills: [],
        commandNames: [],
        routeSummaries: [],
      },
    ],
    resolveAgentDef: () => undefined,
    resolveSkillsPrompt: () => "",
    probeHealthChecks: async () => ({}),
    callTool: vi.fn(),
    listTools: () => [],
    events: {
      emit: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      emitExternal: vi.fn(),
      subscribeExternal: vi.fn(() => () => {}),
      listenerCount: () => 0,
    },
    getProvider: () => null,
    createSession: vi.fn(),
    client: {} as never,
  };
}

async function startRouteServer(
  routes: RouteRegistration[],
  options: { authToken?: string } = {},
): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const match = findRouteMatch(routes, req.method ?? "GET", url.pathname);
    if (!match) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    if (options.authToken && !match.route.bypassAuth) {
      const header = req.headers.authorization;
      const queryToken = url.searchParams.get("token");
      if (header !== `Bearer ${options.authToken}` && queryToken !== options.authToken) {
        if (match.route.authFailureHandler) {
          Promise.resolve(match.route.authFailureHandler(req, res, match.params)).catch((err: Error) => {
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }
    Promise.resolve(match.route.handler(req, res, match.params)).catch((err: Error) => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) {
    throw new Error("test server did not bind to a TCP port");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function postRpc(
  baseUrl: string,
  body: object,
  options: {
    headers?: Record<string, string>;
    includeDefaultVersion?: boolean;
    query?: string;
  } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.includeDefaultVersion !== false) {
    headers["A2A-Version"] = A2A_PROTOCOL_VERSION;
  }
  Object.assign(headers, options.headers);
  const res = await fetch(`${baseUrl}${A2A_RPC_PATH}${options.query ?? ""}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return await res.json();
}

function parseSseJsonRpcResponses(text: string) {
  return text
    .split("\n\n")
    .filter((frame) => frame.trim().length > 0)
    .map((frame) => {
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart())
        .join("\n");
      return JSON.parse(data);
    });
}

function sendMessageParams(configuration: object) {
  return {
    configuration,
    message: {
      role: "ROLE_USER",
      parts: [{ text: "ship the slice", mediaType: "text/plain" }],
    },
  };
}

function errorReason(response: { error?: { data?: Array<{ reason?: string }> } }): string | undefined {
  return response.error?.data?.[0]?.reason;
}

function errorMetadata(response: { error?: { data?: Array<{ metadata?: unknown }> } }): unknown {
  return response.error?.data?.[0]?.metadata;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

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
      return new Response([
        "event: thinking\n",
        "data: {\"content\":\"private reasoning\"}\n\n",
        "event: guardrail\n",
        "data: {\"policy\":\"approval\",\"risk\":\"write\"}\n\n",
        "event: text\n",
        "data: {\"content\":\"partial\"}\n\n",
        "event: done\n",
        "data: {\"session_id\":\"sess-1\",\"result\":\"final answer\"}\n\n",
      ].join(""), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    if (path === "/sessions/sess-unscoped/chat") {
      return new Response([
        "event: text\n",
        "data: {\"content\":\"unscoped partial\"}\n\n",
        "event: done\n",
        "data: {\"session_id\":\"sess-unscoped\",\"result\":\"unscoped final\"}\n\n",
      ].join(""), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    if (path === "/sessions/active-task/events") {
      return new Response([
        "event: text\n",
        "data: {\"content\":\"subscribed partial\"}\n\n",
        "event: done\n",
        "data: {\"session_id\":\"active-task\",\"result\":\"subscribed final\"}\n\n",
      ].join(""), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
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
    "proj-1": [
      {
        id: "task-1",
        createdAt: NOW,
        lastActive: 1,
        busy: false,
        autonomyMode: "supervised",
        source: "daemon",
        projectId: "proj-1",
        conversationId: "conv-1",
      },
    ],
    "proj-2": [
      {
        id: "task-2",
        createdAt: NOW,
        lastActive: 2,
        busy: false,
        autonomyMode: "autonomous",
        source: "daemon",
        projectId: "proj-2",
        conversationId: "conv-2",
      },
      {
        id: "serve-task",
        createdAt: NOW,
        lastActive: 3,
        busy: false,
        autonomyMode: "supervised",
        source: "serve",
        projectId: "proj-2",
        conversationId: "conv-serve",
      },
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
      return new Response([
        "event: text\n",
        "data: {\"content\":\"resumed partial\"}\n\n",
        "event: done\n",
        "data: {\"session_id\":\"task-2\",\"result\":\"resumed final\"}\n\n",
      ].join(""), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
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

function jsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
