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

describe("a2a push notification config validation", () => {
  const state: PushNotificationTestState = { servers: [], tempDirs: [] };

  afterEach(async () => {
    await cleanupPushNotificationTestState(state);
  });

  it("rejects malformed configs and routing mismatches before daemon work starts", async () => {
    const backend = new FakeBackend();
    const backendFactory = vi.fn(() => backend);
    const server = await startRouteServer(a2aRoutes(makeContext(makeStorage(state.tempDirs)), {
      backendFactory,
      pushNotificationFetch: vi.fn(),
    }));
    state.servers.push(server.server);

    const mismatch = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "mismatch",
      method: "CreateTaskPushNotificationConfig",
      params: pushConfigParams({
        tenant: "proj-1",
        scopeId: "proj-2",
      }),
    });
    expect(errorReason(mismatch)).toBe("ROUTING_SCOPE_MISMATCH");
    expect(backendFactory).not.toHaveBeenCalled();

    const invalidUrl = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "bad-url",
      method: "CreateTaskPushNotificationConfig",
      params: pushConfigParams({ url: "file:///tmp/a2a" }),
    });
    expect(invalidUrl.error.code).toBe(-32602);
    expect(backendFactory).not.toHaveBeenCalled();

    const headerInjection = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "bad-auth",
      method: "CreateTaskPushNotificationConfig",
      params: pushConfigParams({
        authentication: {
          scheme: "Bearer",
          credentials: "secret\r\nX-Injected: yes",
        },
      }),
    });
    expect(headerInjection.error.code).toBe(-32602);
    expect(backendFactory).not.toHaveBeenCalled();

    const cleartextAuthentication = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "cleartext-auth",
      method: "CreateTaskPushNotificationConfig",
      params: pushConfigParams({
        id: "cleartext-auth",
        url: "http://callback.example.test/a2a",
        authentication: {
          scheme: "Bearer",
          credentials: "callback-secret",
        },
      }),
    });
    expect(cleartextAuthentication.error.code).toBe(-32602);
    expect(cleartextAuthentication.error.message).toBe(
      "url must use https when callback credentials are configured",
    );
    expect(backendFactory).not.toHaveBeenCalled();

    const cleartextToken = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "cleartext-token",
      method: "CreateTaskPushNotificationConfig",
      params: pushConfigParams({
        id: "cleartext-token",
        url: "http://callback.example.test/a2a",
        token: "config-token",
      }),
    });
    expect(cleartextToken.error.code).toBe(-32602);
    expect(cleartextToken.error.message).toBe(
      "url must use https when callback credentials are configured",
    );
    expect(backendFactory).not.toHaveBeenCalled();

    const numericId = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "numeric-id",
      method: "CreateTaskPushNotificationConfig",
      params: {
        tenant: "proj-1",
        id: 7,
        taskId: "task-1",
        url: "https://callback.example.test/a2a",
      },
    });
    expect(numericId.error.code).toBe(-32602);
    expect(backendFactory).not.toHaveBeenCalled();

    const numericToken = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "numeric-token",
      method: "CreateTaskPushNotificationConfig",
      params: {
        tenant: "proj-1",
        id: "config-2",
        taskId: "task-1",
        url: "https://callback.example.test/a2a",
        token: 7,
      },
    });
    expect(numericToken.error.code).toBe(-32602);
    expect(backendFactory).not.toHaveBeenCalled();

    const numericCredentials = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "numeric-credentials",
      method: "CreateTaskPushNotificationConfig",
      params: {
        tenant: "proj-1",
        id: "config-3",
        taskId: "task-1",
        url: "https://callback.example.test/a2a",
        authentication: {
          scheme: "Bearer",
          credentials: 7,
        },
      },
    });
    expect(numericCredentials.error.code).toBe(-32602);
    expect(backendFactory).not.toHaveBeenCalled();

    const badPageToken = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "bad-page-token",
      method: "ListTaskPushNotificationConfigs",
      params: { taskId: "task-1", tenant: "proj-1", pageToken: "not-an-offset" },
    });
    expect(badPageToken.error.code).toBe(-32602);
    expect(backendFactory).not.toHaveBeenCalled();
  });
});
