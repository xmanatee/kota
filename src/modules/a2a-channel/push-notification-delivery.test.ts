import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupPushNotificationTestState,
  errorReason,
  FakeBackend,
  makeContext,
  makePushNotificationHttp,
  makeStorage,
  type PushNotificationTestState,
  postRpc,
  pushConfigParams,
  startRouteServer,
} from "./push-notification-test-helpers.js";
import {
  a2aRoutes,
  resumeStoredA2APushNotificationSubscriptions,
} from "./routes.js";

describe("a2a push notification delivery", () => {
  const state: PushNotificationTestState = { servers: [], tempDirs: [] };

  afterEach(async () => {
    await cleanupPushNotificationTestState(state);
  });

  it("attaches a task subscription on create and delivers later daemon progress", async () => {
    const storage = makeStorage(state.tempDirs);
    const backend = new FakeBackend();
    const callbackFetch = vi.fn<typeof fetch>(async () => new Response("{}", { status: 202 }));
    const server = await startRouteServer(a2aRoutes(makeContext(storage), {
      backendFactory: () => backend,
      pushNotificationHttp: makePushNotificationHttp(callbackFetch),
    }));
    state.servers.push(server.server);

    await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "create",
      method: "CreateTaskPushNotificationConfig",
      params: pushConfigParams({ id: "config-1" }),
    });

    await vi.waitFor(() => expect(backend.subscriptions).toHaveLength(1));
    expect(backend.subscriptions[0]?.selector).toEqual({
      taskId: "task-1",
      contextId: "proj-1",
      scopeId: "proj-1",
    });

    const current = await emitCurrentStatusUpdate(backend);

    await vi.waitFor(() => expect(callbackFetch).toHaveBeenCalledTimes(1));
    const body = callbackFetch.mock.calls[0]?.[1]?.body;
    if (typeof body !== "string") throw new Error("expected string callback body");
    expect(JSON.parse(body)).toEqual({
      statusUpdate: {
        taskId: "task-1",
        contextId: "proj-1",
        status: current.status,
        metadata: current.metadata,
      },
    });
  });

  it("blocks delivery when a stored callback hostname resolves to a private address", async () => {
    const storage = makeStorage(state.tempDirs);
    const ctx = makeContext(storage);
    const backend = new FakeBackend();
    const callbackFetch = vi.fn<typeof fetch>(async () => new Response("{}", { status: 202 }));
    const callbackAddressResolver = vi.fn(async () => [{
      address: "127.0.0.1",
      family: 4 as const,
    }]);
    const server = await startRouteServer(a2aRoutes(ctx, {
      backendFactory: () => backend,
      pushNotificationHttp: makePushNotificationHttp(callbackFetch, callbackAddressResolver),
    }));
    state.servers.push(server.server);

    await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "create",
      method: "CreateTaskPushNotificationConfig",
      params: pushConfigParams({
        id: "config-1",
        url: "https://callback.example.test/a2a",
      }),
    });

    await vi.waitFor(() => expect(backend.subscriptions).toHaveLength(1));
    await emitCurrentStatusUpdate(backend);

    await vi.waitFor(() => {
      expect(ctx.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("loopback/private-network targets is blocked"),
      );
    });
    expect(callbackAddressResolver).toHaveBeenCalledWith("callback.example.test");
    expect(callbackFetch).not.toHaveBeenCalled();
  });

  it("rehydrates persisted configs into task subscriptions after route restart", async () => {
    const storage = makeStorage(state.tempDirs);
    const initialBackend = new FakeBackend();
    const first = await startRouteServer(a2aRoutes(makeContext(storage), {
      backendFactory: () => initialBackend,
      pushNotificationHttp: makePushNotificationHttp(vi.fn()),
    }));
    state.servers.push(first.server);

    await postRpc(first.baseUrl, {
      jsonrpc: "2.0",
      id: "create",
      method: "CreateTaskPushNotificationConfig",
      params: pushConfigParams({ id: "config-1" }),
    });
    await vi.waitFor(() => expect(initialBackend.subscriptions).toHaveLength(1));

    const restartedBackend = new FakeBackend();
    const callbackFetch = vi.fn<typeof fetch>(async () => new Response("{}", { status: 202 }));
    resumeStoredA2APushNotificationSubscriptions(makeContext(storage), {
      backendFactory: () => restartedBackend,
      pushNotificationHttp: makePushNotificationHttp(callbackFetch),
    });

    await vi.waitFor(() => expect(restartedBackend.subscriptions).toHaveLength(1));
    expect(restartedBackend.subscriptions[0]?.selector).toEqual({
      taskId: "task-1",
      contextId: "proj-1",
      scopeId: "proj-1",
    });

    const current = await emitCurrentStatusUpdate(restartedBackend);

    await vi.waitFor(() => expect(callbackFetch).toHaveBeenCalledTimes(1));
    const body = callbackFetch.mock.calls[0]?.[1]?.body;
    if (typeof body !== "string") throw new Error("expected string callback body");
    expect(JSON.parse(body).statusUpdate).toMatchObject({
      taskId: "task-1",
      contextId: "proj-1",
      status: current.status,
    });
  });

  it("delivers sanitized task updates with callback auth and stops after delete", async () => {
    const callbackUrl = "https://callback.example.test/a2a?secret=query-token#fragment-secret";
    const storage = makeStorage(state.tempDirs);
    const backend = new FakeBackend();
    const callbackFetch = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ approvalAnswer: "approve", ownerQuestion: "yes" }), {
        status: 202,
      })
    );
    const server = await startRouteServer(a2aRoutes(makeContext(storage), {
      backendFactory: () => backend,
      pushNotificationHttp: makePushNotificationHttp(callbackFetch),
    }));
    state.servers.push(server.server);

    await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "create",
      method: "CreateTaskPushNotificationConfig",
      params: pushConfigParams({
        id: "config-1",
        url: callbackUrl,
        authentication: {
          scheme: "Bearer",
          credentials: "callback-secret",
        },
      }),
    });

    const sent = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "send",
      method: "SendMessage",
      params: {
        tenant: "proj-1",
        message: {
          role: "ROLE_USER",
          taskId: "task-1",
          parts: [{ text: "continue task", mediaType: "text/plain" }],
          metadata: { scopeId: "proj-1" },
        },
      },
    });
    expect(sent.result.task.status.state).toBe("TASK_STATE_COMPLETED");

    expect(callbackFetch.mock.calls.length).toBeGreaterThanOrEqual(3);
    const firstCall = callbackFetch.mock.calls[0];
    if (!firstCall) throw new Error("expected a callback delivery");
    const [url, init] = firstCall;
    expect(url).toBe(callbackUrl);
    expect(Object.fromEntries(new Headers(init?.headers).entries())).toEqual({
      authorization: "Bearer callback-secret",
      "content-type": "application/a2a+json",
    });
    const deliveredBodies = callbackFetch.mock.calls.map(([, request]) => {
      const body = request?.body;
      if (typeof body !== "string") throw new Error("expected string callback body");
      return JSON.parse(body);
    });
    expect(deliveredBodies.some((body) => body.statusUpdate?.taskId === "task-1")).toBe(true);
    expect(
      deliveredBodies.some((body) => body.artifactUpdate?.artifact?.parts?.[0]?.text === "partial"),
    ).toBe(true);
    expect(deliveredBodies.every((body) => body.task === undefined)).toBe(true);
    expect(JSON.stringify(deliveredBodies)).not.toContain("\"history\"");
    expect(JSON.stringify(deliveredBodies)).not.toContain("approvalAnswer");
    expect(backend.sentInputs).toHaveLength(1);

    await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "delete",
      method: "DeleteTaskPushNotificationConfig",
      params: { taskId: "task-1", id: "config-1", tenant: "proj-1" },
    });
    await vi.waitFor(() => expect(backend.subscriptions).toHaveLength(0));
    callbackFetch.mockClear();

    await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "send-after-delete",
      method: "SendMessage",
      params: {
        tenant: "proj-1",
        message: {
          role: "ROLE_USER",
          taskId: "task-1",
          parts: [{ text: "continue again", mediaType: "text/plain" }],
          metadata: { scopeId: "proj-1" },
        },
      },
    });
    expect(callbackFetch).not.toHaveBeenCalled();
  });

  it("removes stored configs when the owning task can no longer be resolved", async () => {
    const storage = makeStorage(state.tempDirs);
    const backend = new FakeBackend();
    const server = await startRouteServer(a2aRoutes(makeContext(storage), {
      backendFactory: () => backend,
      pushNotificationHttp: makePushNotificationHttp(vi.fn()),
    }));
    state.servers.push(server.server);

    await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "create",
      method: "CreateTaskPushNotificationConfig",
      params: pushConfigParams({ id: "config-1" }),
    });

    backend.missingTasks.add("task-1");
    const missing = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "missing",
      method: "GetTaskPushNotificationConfig",
      params: { taskId: "task-1", id: "config-1", tenant: "proj-1" },
    });
    expect(errorReason(missing)).toBe("TASK_NOT_FOUND");

    backend.missingTasks.clear();
    const listed = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "list",
      method: "ListTaskPushNotificationConfigs",
      params: { taskId: "task-1", tenant: "proj-1" },
    });
    expect(listed.result.configs).toEqual([]);
  });
});

async function emitCurrentStatusUpdate(backend: FakeBackend) {
  const current = await backend.getTask({
    taskId: "task-1",
    contextId: "proj-1",
    scopeId: "proj-1",
  });
  backend.emitSubscribed({
    statusUpdate: {
      taskId: current.id,
      contextId: current.contextId,
      status: current.status,
      metadata: current.metadata,
    },
  });
  return current;
}
