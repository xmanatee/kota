import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupPushNotificationTestState,
  createRouteClient,
  errorReason,
  FakeBackend,
  makeContext,
  makePushNotificationHttp,
  makeStorage,
  type PushNotificationTestState,
  postRpc,
  pushConfigParams,
} from "./push-notification-test-helpers.js";
import { a2aRoutes } from "./routes.js";

describe("a2a push notification configs", () => {
  const state: PushNotificationTestState = { tempDirs: [] };

  afterEach(async () => {
    await cleanupPushNotificationTestState(state);
  });

  it.each([
    { scopeId: "proj-1", envelope: null },
    { scopeId: null, envelope: null },
    { scopeId: "proj-1", envelope: "taskPushNotificationConfig" },
    { scopeId: "proj-1", envelope: "pushNotificationConfig" },
  ])("creates, reads, lists, persists, and deletes redacted configs ($scopeId, $envelope)", async ({ scopeId, envelope }) => {
    const routing = scopeId === null ? {} : { tenant: scopeId, metadata: { scopeId } };
    const callbackUrl = "https://callback.example.test/a2a?secret=query-token#fragment-secret";
    const redactedUrl = "https://callback.example.test/a2a?...";
    const storage = makeStorage(state.tempDirs);
    const backend = new FakeBackend();
    const getTask = vi.spyOn(backend, "getTask");
    const first = createRouteClient(a2aRoutes(makeContext(storage), {
      backendFactory: () => backend,
      pushNotificationHttp: makePushNotificationHttp(vi.fn()),
    }));

    const config = {
      ...pushConfigParams({
        id: "config-1",
        url: callbackUrl,
        token: "config-token",
        authentication: { scheme: "Bearer", credentials: "callback-secret" },
      }),
      tenant: scopeId ?? undefined,
      ...routing,
    };
    const created = await postRpc(first, {
      jsonrpc: "2.0",
      id: "create",
      method: "CreateTaskPushNotificationConfig",
      params: envelope ? { ...routing, [envelope]: config } : config,
    });
    expect(getTask).toHaveBeenNthCalledWith(1, { taskId: "task-1", scopeId, contextId: null });

    expect(created.result).toEqual({
      id: "config-1",
      taskId: "task-1",
      url: redactedUrl,
      token: "<redacted>",
      authentication: {
        scheme: "Bearer",
        credentials: "<redacted>",
      },
    });
    expect(JSON.stringify(created.result)).not.toContain("callback-secret");
    expect(JSON.stringify(created.result)).not.toContain("config-token");
    expect(JSON.stringify(created.result)).not.toContain("query-token");
    expect(JSON.stringify(created.result)).not.toContain("fragment-secret");

    const fetched = await postRpc(first, {
      jsonrpc: "2.0",
      id: "get",
      method: "GetTaskPushNotificationConfig",
      params: { taskId: "task-1", id: "config-1", ...routing },
    });
    expect(fetched.result).toEqual(created.result);

    const listed = await postRpc(first, {
      jsonrpc: "2.0",
      id: "list",
      method: "ListTaskPushNotificationConfigs",
      params: { taskId: "task-1", ...routing },
    });
    expect(listed.result).toEqual({
      configs: [created.result],
      nextPageToken: "",
    });
    expect(JSON.stringify([created.result, fetched.result, listed.result])).not.toContain(
      "query-token",
    );
    expect(JSON.stringify([created.result, fetched.result, listed.result])).not.toContain(
      "fragment-secret",
    );

    const second = createRouteClient(a2aRoutes(makeContext(storage), {
      backendFactory: () => backend,
      pushNotificationHttp: makePushNotificationHttp(vi.fn()),
    }));
    const persisted = await postRpc(second, {
      jsonrpc: "2.0",
      id: "persisted",
      method: "GetTaskPushNotificationConfig",
      params: { taskId: "task-1", id: "config-1", ...routing },
    });
    expect(persisted.result).toEqual(created.result);

    const deleted = await postRpc(second, {
      jsonrpc: "2.0",
      id: "delete",
      method: "DeleteTaskPushNotificationConfig",
      params: { taskId: "task-1", id: "config-1", ...routing },
    });
    expect(deleted.result).toEqual({});

    const deletedAgain = await postRpc(second, {
      jsonrpc: "2.0",
      id: "delete-again",
      method: "DeleteTaskPushNotificationConfig",
      params: { taskId: "task-1", id: "config-1", ...routing },
    });
    expect(deletedAgain.result).toEqual({});

    const afterDelete = await postRpc(second, {
      jsonrpc: "2.0",
      id: "list-after-delete",
      method: "ListTaskPushNotificationConfigs",
      params: { taskId: "task-1", ...routing },
    });
    expect(afterDelete.result.configs).toEqual([]);
  });

  it("preserves stored configs when a lookup uses the wrong tenant scope", async () => {
    const storage = makeStorage(state.tempDirs);
    const backend = new FakeBackend();
    const server = createRouteClient(a2aRoutes(makeContext(storage), {
      backendFactory: () => backend,
      pushNotificationHttp: makePushNotificationHttp(vi.fn()),
    }));

    const created = await postRpc(server, {
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
      const wrongScope = await postRpc(server, {
        jsonrpc: "2.0",
        id: method,
        method,
        params,
      });
      expect(errorReason(wrongScope)).toBe("TASK_NOT_FOUND");
    }

    const listed = await postRpc(server, {
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
    const server = createRouteClient(a2aRoutes(makeContext(storage), {
      backendFactory: () => backend,
      pushNotificationHttp: makePushNotificationHttp(vi.fn()),
    }));

    const created = await postRpc(server, {
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
