import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { A2A_PROTOCOL_VERSION, A2A_RPC_PATH, A2A_SUPPORTED_PROTOCOL_VERSIONS } from "./protocol.js";
import { a2aRoutes } from "./routes.js";
import {
  closeServer,
  errorMetadata,
  errorReason,
  FakeBackend,
  makeContext,
  parseSseJsonRpcResponses,
  postRpc,
  sendMessageParams,
  startRouteServer,
} from "./routes-test-support.js";

describe("a2a channel JSON-RPC route errors", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.map(closeServer));
    servers.length = 0;
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

  it("rejects mismatched tenant and scopeId routing before daemon work starts", async () => {
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
          metadata: { scopeId: "proj-2" },
        },
      },
    });
    expect(send.error.code).toBe(-32602);
    expect(errorReason(send)).toBe("ROUTING_SCOPE_MISMATCH");
    expect(errorMetadata(send)).toEqual({ tenant: "proj-1", scopeId: "proj-2" });

    const list = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: "tenant-mismatch-list",
      method: "ListTasks",
      params: { tenant: "proj-1", scopeId: "proj-2" },
    });
    expect(errorReason(list)).toBe("ROUTING_SCOPE_MISMATCH");

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
    expect(backend.subscribeSelectors[0]).toEqual({ taskId: "task-1", scopeId: "proj-1", contextId: null });

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
});
