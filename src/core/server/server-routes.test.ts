import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRequestHandler } from "./server-routes.js";

describe("buildRequestHandler route auth", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.map(closeServer));
    servers.length = 0;
  });

  it("lets matched module routes shape auth failures on the serve surface", async () => {
    const handler = vi.fn();
    const server = createServer(buildRequestHandler({
      port: 0,
      pool: { size: 0, get: vi.fn(), list: vi.fn() } as never,
      scheduler: { count: () => 0 } as never,
      bus: { listenerCount: () => 0 } as never,
      moduleRoutes: [
        {
          method: "POST",
          path: "/api/custom",
          authFailureHandler: (_req, res) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { data: [{ reason: "CUSTOM_AUTH" }] } }));
          },
          handler,
        },
      ],
      makeAgent: (() => {
        throw new Error("unused");
      }) as never,
      resolveDefaultAutonomyMode: () => "autonomous",
      authToken: "secret-token",
    }));
    servers.push(server);
    const baseUrl = await listen(server);

    const res = await fetch(`${baseUrl}/api/custom`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ error: { data: [{ reason: "CUSTOM_AUTH" }] } });
    expect(handler).not.toHaveBeenCalled();
  });
});

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
