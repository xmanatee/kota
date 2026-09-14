import { describe, expect, it, vi } from "vitest";
import { A2A_PROTOCOL_VERSION, A2A_RPC_PATH, A2A_SUPPORTED_PROTOCOL_VERSIONS } from "./protocol.js";
import { a2aRoutes } from "./routes.js";
import {
  createRouteClient,
  errorMetadata,
  errorReason,
  FakeBackend,
  makeContext,
  parseSseJsonRpcResponses,
  sendMessageParams,
} from "./routes-test-support.js";

describe("a2a channel streaming routes", () => {
  it("streams SendStreamingMessage status, artifact, final task, and JSON-RPC response as SSE", async () => {
    const backend = new FakeBackend();
    const server = createRouteClient(a2aRoutes(makeContext(), {
      backendFactory: () => backend,
    }));

    const res = await server.request(`${A2A_RPC_PATH}`, {
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
            metadata: { scopeId: "proj-1" },
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
    expect(backend.sentInputs[0]?.scopeId).toBe("proj-1");
  });

  it("emits one SSE version error for streaming version mismatches before backend work", async () => {
    const backend = new FakeBackend();
    const backendFactory = vi.fn(() => backend);
    const server = createRouteClient(a2aRoutes(makeContext(), {
      backendFactory,
    }));

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
      const res = await server.request(`${A2A_RPC_PATH}`, {
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

});
