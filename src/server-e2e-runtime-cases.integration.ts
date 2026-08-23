import http from "node:http";
import { describe, expect, it } from "vitest";
import type { ServerE2ETestContext } from "./server-e2e-basic-cases.integration.js";

type RuntimeCasesContext = ServerE2ETestContext & {
  setMockSend(
    send: ((message: string, transport: any) => Promise<string>) | undefined,
  ): void;
};

export function registerServerE2ERuntimeCases(ctx: RuntimeCasesContext): void {
  describe("HTTP Server E2E", () => {
    describe("concurrency and error handling", () => {
      it("rejects second request while session is busy", async () => {
        const sid = await ctx.createSession();

        let signalInFlight!: () => void;
        const inFlight = new Promise<void>((resolve) => { signalInFlight = resolve; });
        let resolveFirst!: () => void;
        const firstDone = new Promise<void>((resolve) => { resolveFirst = resolve; });

        ctx.setMockSend(async (message, transport) => {
          transport?.emit({ type: "text", content: message });
          signalInFlight();
          await firstDone;
          return message;
        });

        const firstPromise = ctx.httpReq({
          method: "POST",
          path: "/api/chat",
          body: { session_id: sid, message: "first" },
        });
        await inFlight;

        const second = await ctx.httpReq({
          method: "POST",
          path: "/api/chat",
          body: { session_id: sid, message: "second" },
        });
        expect(second.status).toBe(409);
        expect(JSON.parse(second.body).error).toContain("busy");

        resolveFirst();
        await firstPromise;
      });

      it("sends SSE error event when agent throws", async () => {
        const sid = await ctx.createSession();
        ctx.setMockSend(async () => { throw new Error("Claude API failed"); });

        const res = await ctx.httpReq({
          method: "POST",
          path: "/api/chat",
          body: { session_id: sid, message: "trigger error" },
        });
        expect(res.status).toBe(200);
        const errorEvent = ctx.parseSSE(res.body).find((event) => event.event === "error");
        expect(errorEvent).toBeTruthy();
        expect((errorEvent?.data as any).message).toContain("Claude API failed");
      });

      it("sends Data Stream error when agent throws (Vercel format)", async () => {
        ctx.setMockSend(async () => { throw new Error("Claude API failed"); });

        const res = await ctx.httpReq({
          method: "POST",
          path: "/api/chat/vercel",
          body: { messages: [{ role: "user", content: "fail" }] },
        });
        expect(res.status).toBe(200);
        const errorLines = res.body.split("\n").filter((line) => line.startsWith("3:"));
        expect(errorLines.length).toBeGreaterThan(0);
        expect(errorLines[0]).toContain("Claude API failed");
      });

      it("session remains usable after agent error", async () => {
        const sid = await ctx.createSession();
        ctx.setMockSend(async () => { throw new Error("temporary"); });
        await ctx.httpReq({
          method: "POST",
          path: "/api/chat",
          body: { session_id: sid, message: "fail" },
        });
        ctx.setMockSend(undefined);

        const res = await ctx.httpReq({
          method: "POST",
          path: "/api/chat",
          body: { session_id: sid, message: "recover" },
        });
        expect(res.status).toBe(200);
        const done = ctx.parseSSE(res.body).find((event) => event.event === "done");
        expect(done).toBeTruthy();
        expect((done?.data as any).result).toBe("Echo: recover");
      });
    });

    describe("POST /api/events/:name — webhook triggers", () => {
      it("fires an event and returns confirmation", async () => {
        const res = await ctx.httpReq({
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
        const res = await ctx.httpReq({ method: "POST", path: "/api/events/ping" });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).ok).toBe(true);
      });

      it("decodes URL-encoded event names", async () => {
        const res = await ctx.httpReq({
          method: "POST",
          path: "/api/events/session.end",
          body: { sessionId: "abc" },
        });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).event).toBe("session.end");
      });

      it("returns 400 for invalid JSON body", async () => {
        const res = await ctx.httpReq({
          method: "POST",
          path: "/api/events/test",
          rawBody: "{bad json}",
        });
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toContain("Invalid JSON");
      });

      it("returns 400 for malformed percent-encoding in event name", async () => {
        const res = await ctx.httpReq({
          method: "POST",
          path: "/api/events/%ZZ",
          body: {},
        });
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toContain("Invalid event name encoding");
      });

      it("returns 400 for partial percent-encoding in event name", async () => {
        const res = await ctx.httpReq({
          method: "POST",
          path: "/api/events/test%",
          body: {},
        });
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toContain("Invalid event name encoding");
      });

      it("decodes valid percent-encoded event names", async () => {
        const res = await ctx.httpReq({
          method: "POST",
          path: "/api/events/hello%20world",
          body: {},
        });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).event).toBe("hello world");
      });
    });

    describe("GET /api/history — limit validation", () => {
      it.each(["abc", "-5", "0"])(
        "returns 200 with default limit for invalid limit %s",
        async (limit) => {
          const res = await ctx.httpReq({ method: "GET", path: `/api/history?limit=${limit}` });
          expect(res.status).toBe(200);
          expect(Array.isArray(JSON.parse(res.body).conversations)).toBe(true);
        },
      );

      it("caps extremely large limit values", async () => {
        const res = await ctx.httpReq({ method: "GET", path: "/api/history?limit=999999" });
        expect(res.status).toBe(200);
        expect(Array.isArray(JSON.parse(res.body).conversations)).toBe(true);
      });

      it("accepts valid positive limit", async () => {
        const res = await ctx.httpReq({ method: "GET", path: "/api/history?limit=5" });
        expect(res.status).toBe(200);
      });
    });

    describe("GET /api/notifications — SSE connection", () => {
      it("establishes SSE connection and sends connected event", async () => {
        const res = await new Promise<{
          status: number;
          headers: http.IncomingHttpHeaders;
          body: string;
        }>((resolve, reject) => {
          const url = new URL("/api/notifications", ctx.baseUrl);
          let timeout: ReturnType<typeof setTimeout> | undefined;
          const request = http.request(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${ctx.authToken}` },
          }, (response) => {
            const chunks: string[] = [];
            response.setEncoding("utf-8");
            response.on("data", (chunk) => {
              chunks.push(chunk);
              const combined = chunks.join("");
              if (combined.includes("event: connected")) {
                if (timeout) clearTimeout(timeout);
                response.destroy();
                request.destroy();
                resolve({ status: response.statusCode!, headers: response.headers, body: combined });
              }
            });
            timeout = setTimeout(() => {
              request.destroy();
              resolve({
                status: response.statusCode!,
                headers: response.headers,
                body: chunks.join(""),
              });
            }, 2000);
          });
          request.on("error", (error) => {
            if ((error as any).code === "ECONNRESET") return;
            reject(error);
          });
          request.end();
        });

        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toBe("text/event-stream");
        const connected = ctx.parseSSE(res.body).find((event) => event.event === "connected");
        expect(connected).toBeTruthy();
        expect((connected?.data as any).message).toContain("Listening");
      });
    });

    describe("GET /api/daemon/status", () => {
      it("returns server status and daemon info", async () => {
        const res = await ctx.httpReq({ method: "GET", path: "/api/daemon/status" });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toHaveProperty("daemon");
        expect(body).toHaveProperty("server");
        expect(typeof body.server.sessions).toBe("number");
        expect(typeof body.server.pendingSchedules).toBe("number");
        expect(typeof body.server.eventBusListeners).toBe("number");
      });
    });
  });
}
