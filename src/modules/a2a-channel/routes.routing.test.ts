import { describe, expect, it, vi } from "vitest";
import { A2A_PROTOCOL_VERSION, A2A_RPC_PATH, type JsonObject } from "./protocol.js";
import { a2aRoutes } from "./routes.js";
import {
  createRouteClient,
  errorMetadata,
  errorReason,
  FakeBackend,
  makeContext,
  parseSseJsonRpcResponses,
} from "./routes-test-support.js";

const message: JsonObject = { role: "ROLE_USER", parts: [{ text: "hello" }] };
const config: JsonObject = { taskId: "task-1", id: "config-1", url: "https://callback.example.test/a2a" };

// Each entry is a maintained RPC consumer/envelope, not a second method registry.
const requests: { method: string; params: JsonObject; envelope?: string }[] = [
  { method: "SendMessage", params: { message }, envelope: "message" },
  { method: "SendStreamingMessage", params: { message }, envelope: "message" },
  { method: "GetTask", params: { id: "task-1" } },
  { method: "ListTasks", params: {} },
  { method: "CancelTask", params: { id: "task-1" } },
  { method: "SubscribeToTask", params: { id: "task-1" } },
  { method: "CreateTaskPushNotificationConfig", params: config },
  { method: "CreateTaskPushNotificationConfig", params: { taskPushNotificationConfig: config }, envelope: "taskPushNotificationConfig" },
  { method: "CreateTaskPushNotificationConfig", params: { pushNotificationConfig: config }, envelope: "pushNotificationConfig" },
  { method: "GetTaskPushNotificationConfig", params: { taskId: "task-1", id: "config-1" } },
  { method: "ListTaskPushNotificationConfigs", params: { taskId: "task-1" } },
  { method: "DeleteTaskPushNotificationConfig", params: { taskId: "task-1", id: "config-1" } },
];

describe("A2A routing rejection through JSON-RPC and SSE", () => {
  it.each(requests)("rejects malformed and conflicting selectors for $method ($envelope)", async (entry) => {
    const backendFactory = vi.fn(() => new FakeBackend());
    const client = createRouteClient(a2aRoutes(makeContext(), { backendFactory }));
    const placements = [
      (routing: JsonObject): JsonObject => ({ ...entry.params, ...routing }),
      (routing: JsonObject): JsonObject => ({ ...entry.params, metadata: routing }),
    ];
    if (entry.envelope) {
      const envelope = entry.envelope;
      const source = envelope === "message" ? message : config;
      placements.push(
        (routing) => ({ ...entry.params, [envelope]: { ...source, ...routing } }),
        (routing) => ({ ...entry.params, [envelope]: { ...source, metadata: routing } }),
      );
    }
    const invoke = async (params: JsonObject) => {
      const response = await client.request(A2A_RPC_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", "A2A-Version": A2A_PROTOCOL_VERSION },
        body: JSON.stringify({ jsonrpc: "2.0", id: "routing", method: entry.method, params }),
      });
      expect(response.status).toBe(200);
      const streaming = entry.method === "SendStreamingMessage" || entry.method === "SubscribeToTask";
      expect(response.headers.get("content-type")).toContain(streaming ? "text/event-stream" : "application/json");
      const frames = streaming ? parseSseJsonRpcResponses(await response.text()) : [await response.json()];
      expect(frames).toHaveLength(1);
      expect(frames[0]).toMatchObject({ id: "routing", error: { code: -32602 } });
      expect(backendFactory).not.toHaveBeenCalled();
      return frames[0];
    };

    for (const place of placements) {
      for (const key of ["tenant", "scopeId"]) {
        for (const value of [7, "", null, false, [], {}]) {
          // A valid value elsewhere must not mask a malformed supplied selector.
          const response = await invoke({ tenant: "proj-1", scopeId: "proj-1", ...place({ [key]: value }) });
          expect(response.error.message).toBe(`${key} must be a non-empty string`);
        }
        if (place !== placements[0]) {
          const response = await invoke({ [key]: "proj-1", ...place({ [key]: "proj-2" }) });
          expect(response.error.message).toBe(`${key} must use one consistent value`);
        }
      }
      const mismatch = await invoke(place({ tenant: "proj-1", scopeId: "proj-2" }));
      expect(errorReason(mismatch)).toBe("ROUTING_SCOPE_MISMATCH");
      expect(errorMetadata(mismatch)).toEqual({ tenant: "proj-1", scopeId: "proj-2" });
    }
  });
});
