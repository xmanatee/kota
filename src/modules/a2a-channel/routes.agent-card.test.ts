import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  A2A_EXTENDED_CARD_PATH,
  A2A_PROTOCOL_VERSION,
  A2A_RPC_PATH,
  A2A_WELL_KNOWN_CARD_PATH,
} from "./protocol.js";
import { a2aRoutes } from "./routes.js";
import { closeServer, FakeBackend, makeContext, startRouteServer } from "./routes-test-support.js";

describe("a2a channel Agent Card routes", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.map(closeServer));
    servers.length = 0;
  });

  it("returns a public Agent Card with cache headers and bearer-protected RPC metadata", async () => {
    const backend = new FakeBackend();
    const server = await startRouteServer(a2aRoutes(makeContext(), {
      backendFactory: () => backend,
    }));
    servers.push(server.server);

    const res = await fetch(`${server.baseUrl}${A2A_WELL_KNOWN_CARD_PATH}`, {
      headers: {
        "x-forwarded-host": new URL(server.baseUrl).host,
        "x-forwarded-proto": "http",
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const card = await res.json();
    expect(card).toMatchObject({
      name: "KOTA",
      supportedInterfaces: [
        {
          url: `${server.baseUrl}${A2A_RPC_PATH}`,
          protocolBinding: "JSONRPC",
          protocolVersion: A2A_PROTOCOL_VERSION,
        },
      ],
      capabilities: {
        streaming: true,
        pushNotifications: true,
        extendedAgentCard: true,
      },
      securitySchemes: {
        bearer: { httpAuthSecurityScheme: { scheme: "Bearer" } },
      },
      securityRequirements: [{ bearer: [] }],
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
    });
    expect(card.protocolVersion).toBeUndefined();
    expect(card.preferredTransport).toBeUndefined();
    expect(card.url).toBeUndefined();
    expect(card.skills.map((skill: { id: string }) => skill.id)).toContain("kota.session");

    const extended = await fetch(`${server.baseUrl}${A2A_EXTENDED_CARD_PATH}`);
    const unscopedExtended = await extended.json();
    expect(unscopedExtended.supportedInterfaces).toEqual(card.supportedInterfaces);
    expect(unscopedExtended.supportedInterfaces[0].tenant).toBeUndefined();

    const scopedExtended = await fetch(`${server.baseUrl}${A2A_EXTENDED_CARD_PATH}?scopeId=proj-1`);
    expect(scopedExtended.headers.get("cache-control")).toBe("no-store");
    expect((await scopedExtended.json()).supportedInterfaces).toEqual([
      {
        url: `${server.baseUrl}${A2A_RPC_PATH}`,
        protocolBinding: "JSONRPC",
        protocolVersion: A2A_PROTOCOL_VERSION,
        tenant: "proj-1",
      },
    ]);
  });
});
