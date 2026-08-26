import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { A2A_PROTOCOL_VERSION } from "./protocol.js";
import { a2aRoutes } from "./routes.js";
import { closeServer, FakeBackend, makeContext, postRpc, startRouteServer } from "./routes-test-support.js";

describe("a2a channel JSON-RPC routes", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.map(closeServer));
    servers.length = 0;
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
          metadata: { scopeId: "proj-1" },
        },
      },
    });
    expect(send.result.task.id).toBe("task-1");
    expect(send.result.task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(backend.sentInputs[0]).toMatchObject({
      scopeId: "proj-1",
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
      scopeId: null,
      text: "use the unscoped route",
    });

    const get = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: 2,
      method: "GetTask",
      params: { id: "task-1", tenant: "proj-1" },
    });
    expect(get.result.status.state).toBe("TASK_STATE_COMPLETED");
    expect(backend.getSelectors[0]).toEqual({ taskId: "task-1", scopeId: "proj-1", contextId: null });

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
    expect(backend.listFilters[0]).toEqual({ scopeId: "proj-1", contextId: null });

    await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: 31,
      method: "ListTasks",
      params: { contextId: "proj-2" },
    });
    expect(backend.listFilters[1]).toEqual({ scopeId: null, contextId: "proj-2" });

    const cancel = await postRpc(server.baseUrl, {
      jsonrpc: "2.0",
      id: 4,
      method: "CancelTask",
      params: { id: "task-1", tenant: "proj-1", metadata: { scopeId: "proj-1" } },
    });
    expect(cancel.result.status.state).toBe("TASK_STATE_CANCELED");
    expect(backend.cancelSelectors[0]).toEqual({ taskId: "task-1", scopeId: "proj-1", contextId: null });
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
      params: { scopeId: "proj-1" },
    });
    expect(byHeader.result.tasks).toHaveLength(1);

    const byQuery = await postRpc(
      server.baseUrl,
      {
        jsonrpc: "2.0",
        id: "version-query",
        method: "ListTasks",
        params: { scopeId: "proj-2" },
      },
      {
        includeDefaultVersion: false,
        query: `?${new URLSearchParams({ "A2A-Version": A2A_PROTOCOL_VERSION })}`,
      },
    );
    expect(byQuery.result.tasks).toHaveLength(1);
    expect(backend.listFilters).toEqual([
      { scopeId: "proj-1", contextId: null },
      { scopeId: "proj-2", contextId: null },
    ]);
  });
});
