/**
 * End-to-end integration tests for the HTTP server.
 *
 * Exercises the full path: HTTP request → router → session pool → agent session
 * → transport (SSE or Vercel Data Stream via module route) → HTTP response.
 *
 * Mocks AgentSession to avoid real Claude API calls while testing all real
 * server infrastructure: routing, session lifecycle, SSE formatting, error handling.
 */

import type { Server } from "node:http";
import http from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/** Configurable send behavior for the mock agent. Reset after each test. */
let mockSendFn: ((message: string, transport: any) => Promise<string>) | undefined;

vi.mock("./loop.js", () => {
  class MockAgentSession {
    private transport: any;
    send: (message: string) => Promise<string>;
    close = vi.fn();
    getCostSummary = () => "$0.001";
    getConversationId = () => null;

    constructor(opts: any) {
      this.transport = opts?.transport;
      this.send = async (message: string) => {
        if (mockSendFn) return mockSendFn(message, this.transport);
        this.transport?.emit({ type: "status", message: "[kota] Turn 1" });
        this.transport?.emit({ type: "text", content: `Echo: ${message}` });
        this.transport?.emit({ type: "cost", summary: "$0.001", budgetPercent: 5 });
        return `Echo: ${message}`;
      };
    }
  }
  return { AgentSession: MockAgentSession };
});

import { ModuleLoader } from "./module-loader.js";
import { builtinModules } from "./modules/index.js";
import { startServer } from "./server.js";

let server: Server;
let baseUrl: string;

/** Collect session IDs created during tests for cleanup. */
const createdSessionIds: string[] = [];

function waitForPort(s: Server): Promise<number> {
  return new Promise((resolve) => {
    if (s.listening) {
      resolve((s.address() as { port: number }).port);
    } else {
      s.on("listening", () => resolve((s.address() as { port: number }).port));
    }
  });
}

/** Parse SSE text into structured events. */
function parseSSE(raw: string): Array<{ event: string; data: unknown }> {
  const events: Array<{ event: string; data: unknown }> = [];
  for (const block of raw.split("\n\n").filter(Boolean)) {
    let eventName = "";
    let dataStr = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) eventName = line.slice(7);
      if (line.startsWith("data: ")) dataStr = line.slice(6);
    }
    if (eventName && dataStr) {
      try { events.push({ event: eventName, data: JSON.parse(dataStr) }); }
      catch { events.push({ event: eventName, data: dataStr }); }
    }
  }
  return events;
}

/** Make an HTTP request and collect the full response. */
function httpReq(opts: {
  method: string;
  path: string;
  body?: unknown;
  rawBody?: string;
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const url = new URL(opts.path, baseUrl);
  return new Promise((resolve, reject) => {
    const r = http.request(url, {
      method: opts.method,
      headers: (opts.body !== undefined || opts.rawBody) ? { "Content-Type": "application/json" } : {},
    }, (res) => {
      const chunks: string[] = [];
      res.setEncoding("utf-8");
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: chunks.join("") }));
    });
    r.on("error", reject);
    if (opts.rawBody) r.write(opts.rawBody);
    else if (opts.body !== undefined) r.write(JSON.stringify(opts.body));
    r.end();
  });
}

/** Create a session via API and track for cleanup. */
async function createSession(): Promise<string> {
  const res = await httpReq({ method: "POST", path: "/api/sessions" });
  const sid = JSON.parse(res.body).session_id;
  createdSessionIds.push(sid);
  return sid;
}

beforeAll(async () => {
  const origLog = console.log;
  console.log = () => {};
  const loader = new ModuleLoader({} as any, false, { commandsOnly: true });
  await loader.loadAll(builtinModules);
  const moduleRoutes = loader.getRoutes();
  server = startServer({ port: 0, config: {} as any, moduleRoutes });
  const port = await waitForPort(server);
  console.log = origLog;
  baseUrl = `http://localhost:${port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

afterEach(async () => {
  mockSendFn = undefined;
  // Clean up sessions to avoid pool exhaustion
  for (const sid of createdSessionIds) {
    await httpReq({ method: "DELETE", path: `/api/sessions/${sid}` }).catch(() => {});
  }
  createdSessionIds.length = 0;
});

describe("HTTP Server E2E", () => {
  describe("routing", () => {
    it("GET /api/health returns server status", async () => {
      const res = await httpReq({ method: "GET", path: "/api/health" });
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe("ok");
      expect(typeof body.sessions).toBe("number");
      expect(typeof body.activeActions).toBe("number");
    });

    it("OPTIONS returns 204 with CORS headers", async () => {
      const res = await httpReq({ method: "OPTIONS", path: "/api/chat" });
      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe("*");
      expect(res.headers["access-control-allow-methods"]).toContain("POST");
    });

    it("unknown route returns 404", async () => {
      const res = await httpReq({ method: "GET", path: "/api/nonexistent" });
      expect(res.status).toBe(404);
    });

    it("GET / returns web UI HTML", async () => {
      const res = await httpReq({ method: "GET", path: "/" });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.body).toContain("<html");
    });

    it("GET /api/schedules returns list", async () => {
      const res = await httpReq({ method: "GET", path: "/api/schedules" });
      expect(res.status).toBe(200);
      expect(Array.isArray(JSON.parse(res.body).schedules)).toBe(true);
    });
  });

  describe("session lifecycle", () => {
    it("POST /api/sessions creates a session", async () => {
      const sid = await createSession();
      expect(sid).toBeTruthy();
    });

    it("GET /api/sessions lists sessions", async () => {
      await createSession();
      const res = await httpReq({ method: "GET", path: "/api/sessions" });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).sessions.length).toBeGreaterThan(0);
    });

    it("DELETE /api/sessions/:id removes a session", async () => {
      const sid = await createSession();
      const del = await httpReq({ method: "DELETE", path: `/api/sessions/${sid}` });
      expect(del.status).toBe(204);
      // Remove from cleanup list since already deleted
      const idx = createdSessionIds.indexOf(sid);
      if (idx >= 0) createdSessionIds.splice(idx, 1);

      const again = await httpReq({ method: "DELETE", path: `/api/sessions/${sid}` });
      expect(again.status).toBe(404);
    });
  });

  describe("POST /api/chat — KOTA SSE format", () => {
    it("streams SSE events with correct ordering for a new session", async () => {
      const sid = await createSession();
      const res = await httpReq({
        method: "POST",
        path: "/api/chat",
        body: { session_id: sid, message: "Hello" },
      });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("text/event-stream");

      const events = parseSSE(res.body);
      const types = events.map((e) => e.event);

      // Must start with session, end with done
      expect(types[0]).toBe("session");
      expect(types[types.length - 1]).toBe("done");

      // Session event has session_id
      expect((events[0].data as any).session_id).toBe(sid);

      // Done event echoes session_id and result
      const done = events[types.length - 1].data as any;
      expect(done.session_id).toBe(sid);
      expect(done.result).toBe("Echo: Hello");

      // Agent events present between session and done
      expect(types).toContain("text");
      expect(types).toContain("status");
      expect(types).toContain("cost");
    });

    it("reuses existing session when session_id provided", async () => {
      const sid = await createSession();

      // First chat
      await httpReq({ method: "POST", path: "/api/chat", body: { session_id: sid, message: "First" } });

      // Second chat — same session
      const res = await httpReq({ method: "POST", path: "/api/chat", body: { session_id: sid, message: "Second" } });
      expect(res.status).toBe(200);
      const events = parseSSE(res.body);
      expect((events[0].data as any).session_id).toBe(sid);
    });

    it("returns 404 for nonexistent session_id", async () => {
      const res = await httpReq({ method: "POST", path: "/api/chat", body: { session_id: "nonexistent", message: "hi" } });
      expect(res.status).toBe(404);
    });

    it("returns 400 when message is missing", async () => {
      const res = await httpReq({ method: "POST", path: "/api/chat", body: { session_id: "x" } });
      expect(res.status).toBe(400);
    });

    it("returns 400 for non-string message values", async () => {
      const sid = await createSession();
      const res = await httpReq({ method: "POST", path: "/api/chat", body: { session_id: sid, message: 123 } });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).error).toContain("non-empty string");
    });

    it("returns 400 on invalid JSON body", async () => {
      const res = await httpReq({ method: "POST", path: "/api/chat", rawBody: "{not json}" });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).error).toContain("Invalid JSON");
    });
  });

  describe("POST /api/chat/vercel — Vercel AI SDK format", () => {
    it("returns Data Stream response", async () => {
      const res = await httpReq({
        method: "POST",
        path: "/api/chat/vercel",
        body: { messages: [{ role: "user", content: "Hello Vercel" }] },
      });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/plain");
      expect(res.headers["x-vercel-ai-data-stream"]).toBe("v1");

      const lines = res.body.split("\n").filter(Boolean);
      const textLines = lines.filter((l) => l.startsWith("0:"));
      const finishLines = lines.filter((l) => l.startsWith("d:"));
      expect(textLines.length).toBeGreaterThan(0);
      expect(finishLines).toHaveLength(1);
      expect(JSON.parse(finishLines[0].slice(2)).finishReason).toBe("stop");
    });

    it("returns 400 when messages array has no user message", async () => {
      const res = await httpReq({
        method: "POST",
        path: "/api/chat/vercel",
        body: { messages: [{ role: "assistant", content: "no user" }] },
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when body is not Vercel format", async () => {
      const res = await httpReq({
        method: "POST",
        path: "/api/chat/vercel",
        body: { message: "not vercel format" },
      });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).error).toContain("Expected messages array");
    });
  });

  describe("concurrency and error handling", () => {
    it("rejects second request while session is busy", async () => {
      const sid = await createSession();

      mockSendFn = async (msg, transport) => {
        transport?.emit({ type: "text", content: msg });
        await new Promise((r) => setTimeout(r, 200));
        return msg;
      };

      const firstPromise = httpReq({ method: "POST", path: "/api/chat", body: { session_id: sid, message: "first" } });
      await new Promise((r) => setTimeout(r, 50));

      const second = await httpReq({ method: "POST", path: "/api/chat", body: { session_id: sid, message: "second" } });
      expect(second.status).toBe(409);
      expect(JSON.parse(second.body).error).toContain("busy");

      await firstPromise;
    });

    it("sends SSE error event when agent throws", async () => {
      const sid = await createSession();
      mockSendFn = async () => { throw new Error("Claude API failed"); };

      const res = await httpReq({ method: "POST", path: "/api/chat", body: { session_id: sid, message: "trigger error" } });
      expect(res.status).toBe(200);
      const events = parseSSE(res.body);
      const errEvent = events.find((e) => e.event === "error");
      expect(errEvent).toBeTruthy();
      expect((errEvent?.data as any).message).toContain("Claude API failed");
    });

    it("sends Data Stream error when agent throws (Vercel format)", async () => {
      mockSendFn = async () => { throw new Error("Claude API failed"); };

      const res = await httpReq({
        method: "POST",
        path: "/api/chat/vercel",
        body: { messages: [{ role: "user", content: "fail" }] },
      });
      expect(res.status).toBe(200);
      const errorLines = res.body.split("\n").filter((l) => l.startsWith("3:"));
      expect(errorLines.length).toBeGreaterThan(0);
      expect(errorLines[0]).toContain("Claude API failed");
    });

    it("session remains usable after agent error", async () => {
      const sid = await createSession();

      // First: agent errors
      mockSendFn = async () => { throw new Error("temporary"); };
      await httpReq({ method: "POST", path: "/api/chat", body: { session_id: sid, message: "fail" } });
      mockSendFn = undefined;

      // Second: should succeed (session not permanently broken)
      const res = await httpReq({ method: "POST", path: "/api/chat", body: { session_id: sid, message: "recover" } });
      expect(res.status).toBe(200);
      const events = parseSSE(res.body);
      const done = events.find((e) => e.event === "done");
      expect(done).toBeTruthy();
      expect((done?.data as any).result).toBe("Echo: recover");
    });
  });

  describe("POST /api/events/:name — webhook triggers", () => {
    it("fires an event and returns confirmation", async () => {
      const res = await httpReq({
        method: "POST",
        path: "/api/events/deploy.complete",
        body: { repo: "my-app", branch: "main" },
      });
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(body.event).toBe("deploy.complete");
      expect(typeof body.listeners).toBe("number");
    });

    it("accepts empty body", async () => {
      const res = await httpReq({
        method: "POST",
        path: "/api/events/ping",
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).ok).toBe(true);
    });

    it("decodes URL-encoded event names", async () => {
      const res = await httpReq({
        method: "POST",
        path: "/api/events/session.end",
        body: { sessionId: "abc" },
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).event).toBe("session.end");
    });

    it("returns 400 for invalid JSON body", async () => {
      const res = await httpReq({
        method: "POST",
        path: "/api/events/test",
        rawBody: "{bad json}",
      });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).error).toContain("Invalid JSON");
    });

    it("returns 400 for malformed percent-encoding in event name", async () => {
      const res = await httpReq({
        method: "POST",
        path: "/api/events/%ZZ",
        body: {},
      });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).error).toContain("Invalid event name encoding");
    });

    it("returns 400 for partial percent-encoding in event name", async () => {
      const res = await httpReq({
        method: "POST",
        path: "/api/events/test%",
        body: {},
      });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).error).toContain("Invalid event name encoding");
    });

    it("decodes valid percent-encoded event names", async () => {
      const res = await httpReq({
        method: "POST",
        path: "/api/events/hello%20world",
        body: {},
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).event).toBe("hello world");
    });
  });

  describe("GET /api/history — limit validation", () => {
    it("returns 200 with default limit for non-numeric limit param", async () => {
      const res = await httpReq({ method: "GET", path: "/api/history?limit=abc" });
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.conversations)).toBe(true);
    });

    it("returns 200 with default limit for negative limit param", async () => {
      const res = await httpReq({ method: "GET", path: "/api/history?limit=-5" });
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.conversations)).toBe(true);
    });

    it("returns 200 with default limit for zero limit param", async () => {
      const res = await httpReq({ method: "GET", path: "/api/history?limit=0" });
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.conversations)).toBe(true);
    });

    it("caps extremely large limit values", async () => {
      const res = await httpReq({ method: "GET", path: "/api/history?limit=999999" });
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.conversations)).toBe(true);
    });

    it("accepts valid positive limit", async () => {
      const res = await httpReq({ method: "GET", path: "/api/history?limit=5" });
      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/notifications — SSE connection", () => {
    it("establishes SSE connection and sends connected event", async () => {
      const res = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
        const url = new URL("/api/notifications", baseUrl);
        const r = http.request(url, { method: "GET" }, (res) => {
          const chunks: string[] = [];
          res.setEncoding("utf-8");
          res.on("data", (c) => {
            chunks.push(c);
            // Once we get the connected event, close and resolve
            const combined = chunks.join("");
            if (combined.includes("event: connected")) {
              r.destroy();
              resolve({ status: res.statusCode!, headers: res.headers, body: combined });
            }
          });
          // Timeout in case no event arrives
          setTimeout(() => {
            r.destroy();
            resolve({ status: res.statusCode!, headers: res.headers, body: chunks.join("") });
          }, 2000);
        });
        r.on("error", (err) => {
          // ECONNRESET expected when we destroy the request
          if ((err as any).code === "ECONNRESET") return;
          reject(err);
        });
        r.end();
      });

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("text/event-stream");
      const events = parseSSE(res.body);
      const connected = events.find((e) => e.event === "connected");
      expect(connected).toBeTruthy();
      expect((connected?.data as any).message).toContain("Listening");
    });
  });

  describe("GET /api/daemon/status", () => {
    it("returns server status and daemon info", async () => {
      const res = await httpReq({ method: "GET", path: "/api/daemon/status" });
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty("daemon");
      expect(body).toHaveProperty("server");
      expect(typeof body.server.sessions).toBe("number");
      expect(typeof body.server.activeActions).toBe("number");
      expect(typeof body.server.pendingSchedules).toBe("number");
      expect(typeof body.server.eventBusListeners).toBe("number");
    });
  });
});
