/**
 * Behavioral coverage for the daemon-side sessions transport: one-shot
 * lifecycle, request mapping, response decoding, and visible failures.
 */

import { describe, expect, it } from "vitest";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import daemonOpsModule from "./index.js";

type RecordedCall = {
  path: string;
  init: RequestInit | undefined;
};

type FetchResponder = (
  path: string,
  init: RequestInit | undefined,
) => Response | Promise<Response>;

function makeRecordingTransport(responder: FetchResponder): {
  transport: DaemonTransport;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({ Authorization: "Bearer test-token" }),
    request: async () => null,
    requestStrict: async () => {
      throw new Error("not used");
    },
    fetchRaw: async (path, init) => {
      calls.push({ path, init });
      return responder(path, init);
    },
    events: async function* () {
      // empty generator
    },
  };
  return { transport, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function malformedJsonResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("daemon-ops module daemonClient(link) — sessions namespace", () => {
  it("marks a scope-gated passive one-shot session and closes it", async () => {
    const { transport, calls } = makeRecordingTransport((path, init) => {
      if (path === "/sessions" && init?.method === "POST") {
        return jsonResponse(201, { session_id: "review/session" });
      }
      if (
        path === `/sessions/${encodeURIComponent("review/session")}/chat` &&
        init?.method === "POST"
      ) {
        return new Response([
          "event: session",
          'data: {"session_id":"review/session"}',
          "",
          "event: done",
          'data: {"session_id":"review/session","result":"reviewed"}',
          "",
        ].join("\n"), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      if (
        path === `/sessions/${encodeURIComponent("review/session")}` &&
        init?.method === "DELETE"
      ) {
        return new Response(null, { status: 204 });
      }
      return jsonResponse(404, { error: "unexpected request" });
    });

    const contributed = daemonOpsModule.daemonClient!(transport);
    await expect(
      contributed.sessions!.runOneShot("Review evidence.", {
        autonomyMode: "passive",
        agentBackoff: "scope",
      }),
    ).resolves.toEqual({ ok: true, text: "reviewed" });
    expect(calls.map((call) => [call.path, call.init?.method])).toEqual([
      ["/sessions", "POST"],
      [`/sessions/${encodeURIComponent("review/session")}/chat`, "POST"],
      [`/sessions/${encodeURIComponent("review/session")}`, "DELETE"],
    ]);
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      autonomy_mode: "passive",
    });
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({
      message: "Review evidence.",
      agent_backoff: "scope",
    });
  });

  it("routes list() through GET /sessions with auth headers and no body", async () => {
    const sessionEntries = [
      {
        id: "s1",
        createdAt: "2026-05-05T00:00:00Z",
        lastActive: 1715000000000,
        autonomyMode: "supervised" as const,
      },
    ];
    const { transport, calls } = makeRecordingTransport(() =>
      jsonResponse(200, { sessions: sessionEntries }),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.sessions!.list();
    expect(result).toEqual({ sessions: sessionEntries });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/sessions");
    expect(calls[0]!.init?.method).toBe("GET");
    expect(calls[0]!.init?.headers).toEqual({ Authorization: "Bearer test-token" });
    expect(calls[0]!.init?.body).toBeUndefined();
  });

  it("list() throws on non-ok HTTP response with the daemon's error message", async () => {
    const { transport } = makeRecordingTransport(() =>
      jsonResponse(502, { error: "daemon backend unavailable" }),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    await expect(contributed.sessions!.list()).rejects.toThrow(
      /daemon backend unavailable/,
    );
  });

  it("routes setAutonomyMode(id, mode) through PATCH /sessions/:id with snake_case body", async () => {
    const { transport, calls } = makeRecordingTransport(() =>
      jsonResponse(200, {
        autonomy_mode: "supervised",
        source: "daemon",
        serveOwned: false,
      }),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.sessions!.setAutonomyMode("sess-1", "supervised");
    expect(result).toEqual({
      ok: true,
      autonomyMode: "supervised",
      source: "daemon",
      serveOwned: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/sessions/sess-1");
    expect(calls[0]!.init?.method).toBe("PATCH");
    expect(calls[0]!.init?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      autonomy_mode: "supervised",
    });
  });

  it("setAutonomyMode escapes path-id characters via encodeURIComponent", async () => {
    const { transport, calls } = makeRecordingTransport(() =>
      jsonResponse(200, {
        autonomy_mode: "passive",
        source: "daemon",
        serveOwned: false,
      }),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    await contributed.sessions!.setAutonomyMode("sess/1 with space", "passive");
    expect(calls[0]!.path).toBe(
      `/sessions/${encodeURIComponent("sess/1 with space")}`,
    );
  });

  it("setAutonomyMode defaults source to \"daemon\" and serveOwned to false when omitted", async () => {
    const { transport } = makeRecordingTransport(() =>
      jsonResponse(200, { autonomy_mode: "passive" }),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.sessions!.setAutonomyMode("sess-1", "passive");
    expect(result).toEqual({
      ok: true,
      autonomyMode: "passive",
      source: "daemon",
      serveOwned: false,
    });
  });

  it("setAutonomyMode decodes the not_found arm on a 404 response", async () => {
    const { transport } = makeRecordingTransport(() =>
      jsonResponse(404, { error: "session not found" }),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.sessions!.setAutonomyMode(
      "missing",
      "supervised",
    );
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("setAutonomyMode surfaces a network failure", async () => {
    const { transport } = makeRecordingTransport(() => {
      throw new TypeError("fetch failed");
    });
    const contributed = daemonOpsModule.daemonClient!(transport);
    await expect(
      contributed.sessions!.setAutonomyMode("sess-1", "supervised"),
    ).rejects.toThrow(/fetch failed/);
  });

  it("setAutonomyMode surfaces a JSON parse failure from the success body", async () => {
    const { transport } = makeRecordingTransport(() =>
      malformedJsonResponse(200, "not-json"),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    await expect(
      contributed.sessions!.setAutonomyMode("sess-1", "supervised"),
    ).rejects.toThrow();
  });

  it("setAutonomyMode surfaces `HTTP <status>` throws when the daemon body lacks an error message", async () => {
    const { transport } = makeRecordingTransport(() =>
      malformedJsonResponse(502, "not-json"),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    await expect(
      contributed.sessions!.setAutonomyMode("sess-1", "supervised"),
    ).rejects.toThrow(/HTTP 502/);
  });

  it("setAutonomyMode surfaces non-ok responses with a daemon-supplied error body", async () => {
    const { transport } = makeRecordingTransport(() =>
      jsonResponse(502, { error: "internal" }),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    await expect(
      contributed.sessions!.setAutonomyMode("sess-1", "supervised"),
    ).rejects.toThrow(/internal/);
  });

  it("setAutonomyMode honors serveOwned: true with source \"serve\"", async () => {
    const { transport } = makeRecordingTransport(() =>
      jsonResponse(200, {
        autonomy_mode: "supervised",
        source: "serve",
        serveOwned: true,
      }),
    );
    const contributed = daemonOpsModule.daemonClient!(transport);
    const result = await contributed.sessions!.setAutonomyMode("sess-1", "supervised");
    expect(result).toEqual({
      ok: true,
      autonomyMode: "supervised",
      source: "serve",
      serveOwned: true,
    });
  });
});
