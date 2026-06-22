import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupPushNotificationTestState,
  errorReason,
  FakeBackend,
  makeContext,
  makeStorage,
  type PushNotificationTestState,
  postRpc,
  pushConfigParams,
  startRouteServer,
} from "./push-notification-test-helpers.js";
import { a2aRoutes } from "./routes.js";

describe("a2a push notification configs", () => {
  const state: PushNotificationTestState = { servers: [], tempDirs: [] };

  afterEach(async () => {
    await cleanupPushNotificationTestState(state);
  });

  it("creates, reads, lists, persists, and deletes redacted task-scoped configs", async () => {
    const storage = makeStorage(state.tempDirs);
    const backend = new FakeBackend();
    const first = await startRouteServer(a2aRoutes(makeContext(storage), {
      backendFactory: () => backend,
      pushNotificationFetch: vi.fn(),
    }));
    state.servers.push(first.server);

    const created = await postRpc(first.baseUrl, {
      jsonrpc: "2.0",
      id: "create",
      method: "CreateTaskPushNotificationConfig",
      params: pushConfigParams({
        id: "config-1",
        url: "https://callback.example.test/a2a?secret=query-token",
        token: "config-token",
        authentication: {
          scheme: "Bearer",
          credentials: "callback-secret",
        },
      }),
    });

    expect(created.result).toEqual({
      id: "config-1",
      taskId: "task-1",
      url: "https://callback.example.test/a2a?secret=query-token",
      token: "<redacted>",
      authentication: {
        scheme: "Bearer",
        credentials: "<redacted>",
      },
    });
    expect(JSON.stringify(created.result)).not.toContain("callback-secret");
    expect(JSON.stringify(created.result)).not.toContain("config-token");

    const fetched = await postRpc(first.baseUrl, {
      jsonrpc: "2.0",
      id: "get",
      method: "GetTaskPushNotificationConfig",
      params: { taskId: "task-1", id: "config-1", tenant: "proj-1" },
    });
    expect(fetched.result).toEqual(created.result);

    const listed = await postRpc(first.baseUrl, {
      jsonrpc: "2.0",
      id: "list",
      method: "ListTaskPushNotificationConfigs",
      params: { taskId: "task-1", tenant: "proj-1" },
    });
    expect(listed.result).toEqual({
      configs: [created.result],
      nextPageToken: "",
    });

    const second = await startRouteServer(a2aRoutes(makeContext(storage), {
      backendFactory: () => backend,
      pushNotificationFetch: vi.fn(),
    }));
    state.servers.push(second.server);
    const persisted = await postRpc(second.baseUrl, {
      jsonrpc: "2.0",
      id: "persisted",
      method: "GetTaskPushNotificationConfig",
      params: { taskId: "task-1", id: "config-1", tenant: "proj-1" },
    });
    expect(persisted.result).toEqual(created.result);

    const deleted = await postRpc(second.baseUrl, {
      jsonrpc: "2.0",
      id: "delete",
      method: "DeleteTaskPushNotificationConfig",
      params: { taskId: "task-1", id: "config-1", tenant: "proj-1" },
    });
    expect(deleted.result).toEqual({});

    const deletedAgain = await postRpc(second.baseUrl, {
      jsonrpc: "2.0",
      id: "delete-again",
      method: "DeleteTaskPushNotificationConfig",
      params: { taskId: "task-1", id: "config-1", tenant: "proj-1" },
    });
    expect(deletedAgain.result).toEqual({});

    const afterDelete = await postRpc(second.baseUrl, {
      jsonrpc: "2.0",
      id: "list-after-delete",
      method: "ListTaskPushNotificationConfigs",
      params: { taskId: "task-1", tenant: "proj-1" },
    });
    expect(afterDelete.result.configs).toEqual([]);
  });

  it("preserves stored configs when a lookup uses the wrong tenant scope", async () => {
    const storage = makeStorage(state.tempDirs);
    const backend = new FakeBackend();
    const server = await startRouteServer(a2aRoutes(makeContext(storage), {
      backendFactory: () => backend,
      pushNotificationFetch: vi.fn(),
    }));
    state.servers.push(server.server);

    const created = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "create",
      method: "CreateTaskPushNotificationConfig",
      params: pushConfigParams({ id: "config-1" }),
    });

    for (const [method, params] of [
      [
        "GetTaskPushNotificationConfig",
        { taskId: "task-1", id: "config-1", tenant: "proj-2" },
      ],
      ["ListTaskPushNotificationConfigs", { taskId: "task-1", tenant: "proj-2" }],
      [
        "DeleteTaskPushNotificationConfig",
        { taskId: "task-1", id: "config-1", tenant: "proj-2" },
      ],
    ] as const) {
      const wrongScope = await postRpc(server.baseUrl, {
        jsonrpc: "2.0",
        id: method,
        method,
        params,
      });
      expect(errorReason(wrongScope)).toBe("TASK_NOT_FOUND");
    }

    const listed = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "list-valid-scope",
      method: "ListTaskPushNotificationConfigs",
      params: { taskId: "task-1", tenant: "proj-1" },
    });
    expect(listed.result.configs).toEqual([created.result]);
  });

  it("allows non-credentialed http callback configs", async () => {
    const storage = makeStorage(state.tempDirs);
    const backend = new FakeBackend();
    const server = await startRouteServer(a2aRoutes(makeContext(storage), {
      backendFactory: () => backend,
      pushNotificationFetch: vi.fn(),
    }));
    state.servers.push(server.server);

    const created = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "anonymous-http",
      method: "CreateTaskPushNotificationConfig",
      params: pushConfigParams({
        id: "anonymous-http",
        url: "http://callback.example.test/a2a",
      }),
    });

    expect(created.result).toMatchObject({
      id: "anonymous-http",
      url: "http://callback.example.test/a2a",
    });
  });
});
