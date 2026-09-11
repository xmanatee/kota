import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import type { RouteRegistration } from "#core/modules/module-types.js";
import { routeInvocationContract } from "./route-invocation-test-support.js";
import { buildRequestHandler, type ServerContext } from "./server-routes.js";
import { SessionPool } from "./session-pool.js";

describe("buildRequestHandler route auth", () => {
  const servers: Server[] = [];
  const authToken = "secret-token";

  afterEach(async () => {
    await Promise.all(servers.map(closeServer));
    servers.length = 0;
  });

  routeInvocationContract(async (routes) => {
    const server = createServer(makeRequestHandler(routes, authToken));
    servers.push(server);
    return listen(server);
  }, authToken);

  it.each(["sync", "async"] as const)("contains %s failures in direct host routes", async (failure) => {
    const pool = new SessionPool();
    const fail = () => { throw new Error("host route failed"); };
    vi.spyOn(pool, "get").mockImplementation(fail);
    vi.spyOn(pool, "size", "get").mockImplementation(fail);
    const server = createServer(makeRequestHandler([], authToken, { pool }));
    servers.push(server);
    const baseUrl = await listen(server);
    const response = await fetch(`${baseUrl}${failure === "sync" ? "/api/health" : "/api/sessions/example"}`, {
      method: failure === "sync" ? "GET" : "PATCH",
      headers: { Authorization: `Bearer ${authToken}` },
      ...(failure === "async" ? { body: JSON.stringify({ autonomy_mode: "supervised" }) } : {}),
    });
    expect(response.status).toBe(500);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toEqual({ error: "host route failed" });
  });

  it("serves non-API routes and preflight without API token authentication", async () => {
    const server = createServer(makeRequestHandler([{
      method: "GET", path: "/", handler: (_req, res) => { res.end("dashboard"); },
    }], authToken));
    servers.push(server);
    const baseUrl = await listen(server);
    const entry = await fetch(baseUrl);
    expect(entry.status).toBe(200);
    expect(await entry.text()).toBe("dashboard");
    expect(entry.headers.get("set-cookie")).toBeNull();
    const preflight = await fetch(`${baseUrl}/api/sessions`, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
  });

  it("rejects approval mutations authenticated only by query token", async () => {
    const handler = vi.fn((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const server = createServer(
      makeRequestHandler(
        [
          {
            method: "POST",
            path: "/api/approvals/approve-all",
            handler,
          },
        ],
        authToken,
      ),
    );
    servers.push(server);
    const baseUrl = await listen(server);

    const res = await fetch(`${baseUrl}/api/approvals/approve-all?token=${authToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("allows approval mutations authenticated by bearer header", async () => {
    const handler = vi.fn((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const server = createServer(
      makeRequestHandler(
        [
          {
            method: "POST",
            path: "/api/approvals/approve-all",
            handler,
          },
        ],
        authToken,
      ),
    );
    servers.push(server);
    const baseUrl = await listen(server);

    const res = await fetch(`${baseUrl}/api/approvals/approve-all`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("keeps query-token authentication available for GET routes", async () => {
    const handler = vi.fn((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const server = createServer(
      makeRequestHandler(
        [
          {
            method: "GET",
            path: "/api/attention",
            handler,
          },
        ],
        authToken,
      ),
    );
    servers.push(server);
    const baseUrl = await listen(server);

    const res = await fetch(`${baseUrl}/api/attention?token=${authToken}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledOnce();
  });
});

function makeRequestHandler(
  moduleRoutes: RouteRegistration[],
  authToken: string,
  overrides: Partial<ServerContext> = {},
): ReturnType<typeof buildRequestHandler> {
  return buildRequestHandler({
    port: 0,
    pool: new SessionPool(),
    bus: new EventBus(),
    moduleRoutes,
    makeAgent: () => {
      throw new Error("unused");
    },
    resolveDefaultAutonomyMode: () => "autonomous",
    authToken,
    ...overrides,
  });
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) {
        throw new Error("test server did not bind to a TCP port");
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
