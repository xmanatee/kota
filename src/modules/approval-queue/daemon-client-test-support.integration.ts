import type {
  ApprovalClientProjection,
  ApprovalStatus,
} from "#core/daemon/approval-queue.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";

export type RecordedCall =
  | {
      method: string;
      path: string;
      body: unknown;
      shape: "request" | "requestStrict";
    }
  | {
      path: string;
      init: RequestInit | undefined;
      shape: "fetchRaw";
    };

export const ENCODING_SENSITIVE_ID = "weird/id %name with space";

export function makeRecordingTransport(
  responder: (
    method: string,
    path: string,
    body: unknown,
    shape: "request" | "requestStrict" | "fetchRaw",
  ) => unknown,
): { transport: DaemonTransport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({}),
		request: async <T>(method: string, path: string, body?: unknown): Promise<T | null> => {
      calls.push({ method, path, body, shape: "request" });
      return responder(method, path, body, "request") as T | null;
    },
		requestStrict: async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      calls.push({ method, path, body, shape: "requestStrict" });
      return responder(method, path, body, "requestStrict") as T;
    },
    fetchRaw: async (path, init) => {
      calls.push({ path, init, shape: "fetchRaw" });
      const value = responder(init?.method ?? "GET", path, init?.body, "fetchRaw");
      if (value instanceof Response) return value;
      if (value === null) {
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(value), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    events: async function* () {
      // no events
    },
  };
  return { transport, calls };
}

export function makeApproval(
  id: string,
  status: ApprovalStatus = "pending",
): ApprovalClientProjection {
  return {
    id,
    scopeId: "scope-test",
    kind: "tool_call",
    tool: "shell",
    input: { redacted: true, reason: "tool-io" },
    review: {
      status: "available",
      input: { command: `echo ${id}` },
      digest: "a".repeat(64),
    },
    risk: "moderate",
    reason: "test approval",
    createdAt: "2026-05-04T12:34:56.000Z",
    status,
  };
}
