import http from "node:http";
import { describe, expect, it } from "vitest";

export type ServerE2ETestContext = {
  readonly authToken: string;
  readonly baseUrl: string;
  readonly createdSessionIds: string[];
  createSession(): Promise<string>;
  httpReq(opts: {
    method: string;
    path: string;
    body?: unknown;
    rawBody?: string;
    noAuth?: boolean;
  }): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>;
  parseSSE(raw: string): Array<{ event: string; data: unknown }>;
};

export function registerServerE2EBasicCases(ctx: ServerE2ETestContext): void {
  describe("HTTP Server E2E", () => {
    describe("auth", () => {
      it("returns 401 on /api/* without auth token", async () => {
        const res = await ctx.httpReq({ method: "GET", path: "/api/health", noAuth: true });
        expect(res.status).toBe(401);
        expect(JSON.parse(res.body)).toMatchObject({ error: "Unauthorized" });
      });

      it("returns 401 with wrong auth token", async () => {
        const url = new URL("/api/health", ctx.baseUrl);
        const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
          const request = http.request(url, {
            method: "GET",
            headers: { Authorization: "Bearer wrong-token" },
          }, (response) => {
            const chunks: string[] = [];
            response.setEncoding("utf-8");
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => resolve({ status: response.statusCode!, body: chunks.join("") }));
          });
          request.on("error", reject);
          request.end();
        });
        expect(res.status).toBe(401);
      });

      it("allows /api/* with valid bearer token", async () => {
        const res = await ctx.httpReq({ method: "GET", path: "/api/health" });
        expect(res.status).toBe(200);
      });

      it("allows /api/* with valid token query param", async () => {
        const res = await ctx.httpReq({
          method: "GET",
          path: `/api/health?token=${ctx.authToken}`,
          noAuth: true,
        });
        expect(res.status).toBe(200);
      });

      it("allows GET / without auth (web UI)", async () => {
        const res = await ctx.httpReq({ method: "GET", path: "/", noAuth: true });
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("text/html");
      });
    });

    describe("routing", () => {
      it("GET /api/health returns server status", async () => {
        const res = await ctx.httpReq({ method: "GET", path: "/api/health" });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.status).toBe("ok");
        expect(typeof body.sessions).toBe("number");
        expect(typeof body.pendingSchedules).toBe("number");
      });

      it("OPTIONS returns 204 with CORS headers", async () => {
        const res = await ctx.httpReq({ method: "OPTIONS", path: "/api/chat" });
        expect(res.status).toBe(204);
        expect(res.headers["access-control-allow-origin"]).toBe("*");
        expect(res.headers["access-control-allow-methods"]).toContain("POST");
      });

      it("unknown route returns 404", async () => {
        const res = await ctx.httpReq({ method: "GET", path: "/api/nonexistent" });
        expect(res.status).toBe(404);
      });

      it("GET / returns web UI HTML", async () => {
        const res = await ctx.httpReq({ method: "GET", path: "/" });
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("text/html");
        expect(res.body).toContain("<html");
      });

      it("GET /assets/<file> serves static asset with immutable cache header", async () => {
        const indexHtml = await ctx.httpReq({ method: "GET", path: "/", noAuth: true });
        const match = indexHtml.body.match(/\/assets\/([^"'>]+)/);
        expect(match).not.toBeNull();
        const assetPath = `/assets/${match![1]}`;
        const res = await ctx.httpReq({ method: "GET", path: assetPath, noAuth: true });
        expect(res.status).toBe(200);
        expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
        expect(typeof res.headers["content-type"]).toBe("string");
        expect(res.body.length).toBeGreaterThan(0);
      });

      it("GET /assets/<missing> returns 404 JSON via the module route", async () => {
        const res = await ctx.httpReq({
          method: "GET",
          path: "/assets/does-not-exist.js",
          noAuth: true,
        });
        expect(res.status).toBe(404);
        expect(JSON.parse(res.body)).toEqual({ error: "Not found" });
      });

      it("GET /api/schedules returns list", async () => {
        const res = await ctx.httpReq({ method: "GET", path: "/api/schedules" });
        expect(res.status).toBe(200);
        expect(Array.isArray(JSON.parse(res.body).schedules)).toBe(true);
      });
    });

    describe("session lifecycle", () => {
      it("POST /api/sessions creates a session", async () => {
        const sid = await ctx.createSession();
        expect(sid).toBeTruthy();
      });

      it("GET /api/sessions lists sessions", async () => {
        await ctx.createSession();
        const res = await ctx.httpReq({ method: "GET", path: "/api/sessions" });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).sessions.length).toBeGreaterThan(0);
      });

      it("DELETE /api/sessions/:id removes a session", async () => {
        const sid = await ctx.createSession();
        const deleted = await ctx.httpReq({ method: "DELETE", path: `/api/sessions/${sid}` });
        expect(deleted.status).toBe(204);
        const index = ctx.createdSessionIds.indexOf(sid);
        if (index >= 0) ctx.createdSessionIds.splice(index, 1);

        const again = await ctx.httpReq({ method: "DELETE", path: `/api/sessions/${sid}` });
        expect(again.status).toBe(404);
      });
    });

    describe("POST /api/chat — KOTA SSE format", () => {
      it("streams SSE events with correct ordering for a new session", async () => {
        const sid = await ctx.createSession();
        const res = await ctx.httpReq({
          method: "POST",
          path: "/api/chat",
          body: { session_id: sid, message: "Hello" },
        });
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toBe("text/event-stream");

        const events = ctx.parseSSE(res.body);
        const types = events.map((event) => event.event);
        expect(types[0]).toBe("session");
        expect(types[types.length - 1]).toBe("done");
        expect((events[0].data as any).session_id).toBe(sid);

        const done = events[types.length - 1].data as any;
        expect(done.session_id).toBe(sid);
        expect(done.result).toBe("Echo: Hello");
        expect(types).toContain("text");
        expect(types).toContain("status");
        expect(types).toContain("cost");
      });

      it("reuses existing session when session_id provided", async () => {
        const sid = await ctx.createSession();
        await ctx.httpReq({ method: "POST", path: "/api/chat", body: { session_id: sid, message: "First" } });
        const res = await ctx.httpReq({ method: "POST", path: "/api/chat", body: { session_id: sid, message: "Second" } });
        expect(res.status).toBe(200);
        expect((ctx.parseSSE(res.body)[0].data as any).session_id).toBe(sid);
      });

      it("returns 404 for nonexistent session_id", async () => {
        const res = await ctx.httpReq({ method: "POST", path: "/api/chat", body: { session_id: "nonexistent", message: "hi" } });
        expect(res.status).toBe(404);
      });

      it("returns 400 when message is missing", async () => {
        const res = await ctx.httpReq({ method: "POST", path: "/api/chat", body: { session_id: "x" } });
        expect(res.status).toBe(400);
      });

      it("returns 400 for non-string message values", async () => {
        const sid = await ctx.createSession();
        const res = await ctx.httpReq({ method: "POST", path: "/api/chat", body: { session_id: sid, message: 123 } });
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toContain("non-empty string");
      });

      it("returns 400 on invalid JSON body", async () => {
        const res = await ctx.httpReq({ method: "POST", path: "/api/chat", rawBody: "{not json}" });
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toContain("Invalid JSON");
      });
    });

    describe("POST /api/chat/vercel — Vercel AI SDK format", () => {
      it("returns Data Stream response", async () => {
        const res = await ctx.httpReq({
          method: "POST",
          path: "/api/chat/vercel",
          body: { messages: [{ role: "user", content: "Hello Vercel" }] },
        });
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("text/plain");
        expect(res.headers["x-vercel-ai-data-stream"]).toBe("v1");

        const lines = res.body.split("\n").filter(Boolean);
        const textLines = lines.filter((line) => line.startsWith("0:"));
        const finishLines = lines.filter((line) => line.startsWith("d:"));
        expect(textLines.length).toBeGreaterThan(0);
        expect(finishLines).toHaveLength(1);
        expect(JSON.parse(finishLines[0].slice(2)).finishReason).toBe("stop");
      });

      it("returns 400 when messages array has no user message", async () => {
        const res = await ctx.httpReq({
          method: "POST",
          path: "/api/chat/vercel",
          body: { messages: [{ role: "assistant", content: "no user" }] },
        });
        expect(res.status).toBe(400);
      });

      it("returns 400 when body is not Vercel format", async () => {
        const res = await ctx.httpReq({
          method: "POST",
          path: "/api/chat/vercel",
          body: { message: "not vercel format" },
        });
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toContain("Expected messages array");
      });
    });
  });
}
