import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupPushNotificationTestState,
  FakeBackend,
  makeContext,
  makePushNotificationHttp,
  makeStorage,
  type PushNotificationTestState,
  postRpc,
  pushConfigParams,
  startRouteServer,
} from "./push-notification-test-helpers.js";
import { a2aRoutes } from "./routes.js";

describe("a2a push notification callback hosts", () => {
  const state: PushNotificationTestState = { servers: [], tempDirs: [] };

  afterEach(async () => {
    await cleanupPushNotificationTestState(state);
  });

  it("rejects non-public callback address literals before daemon work starts", async () => {
    const backend = new FakeBackend();
    const backendFactory = vi.fn(() => backend);
    const server = await startRouteServer(a2aRoutes(makeContext(makeStorage(state.tempDirs)), {
      backendFactory,
      pushNotificationHttp: makePushNotificationHttp(vi.fn()),
    }));
    state.servers.push(server.server);

    for (const url of [
      "https://[::1]/a2a",
      "https://[fd00::1]/a2a",
      "https://[fe80::1]/a2a",
      "https://[::ffff:127.0.0.1]/a2a",
      "https://[::ffff:10.0.0.1]/a2a",
      "https://[::ffff:192.168.0.1]/a2a",
    ]) {
      const response = await postRpc(server.baseUrl, {
        jsonrpc: "2.0",
        id: url,
        method: "CreateTaskPushNotificationConfig",
        params: pushConfigParams({ url }),
      });
      expect(response.error.code).toBe(-32602);
      expect(response.error.message).toBe("url must use a non-local callback host");
    }
    expect(backendFactory).not.toHaveBeenCalled();
  });

  it("allows public IPv6 callback address literals", async () => {
    const storage = makeStorage(state.tempDirs);
    const backend = new FakeBackend();
    const server = await startRouteServer(a2aRoutes(makeContext(storage), {
      backendFactory: () => backend,
      pushNotificationHttp: makePushNotificationHttp(vi.fn()),
    }));
    state.servers.push(server.server);

    const created = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "public-ipv6",
      method: "CreateTaskPushNotificationConfig",
      params: pushConfigParams({
        id: "public-ipv6",
        url: "https://[2606:4700:4700::1111]/a2a",
      }),
    });

    expect(created.result).toMatchObject({
      id: "public-ipv6",
      url: "https://[2606:4700:4700::1111]/a2a",
    });
  });
});
