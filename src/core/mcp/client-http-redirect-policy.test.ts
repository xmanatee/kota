import { afterEach, describe, expect, it, vi } from "vitest";
import { MCP_DRAFT_PROTOCOL_VERSION, McpClient } from "./client.js";
import {
  jsonRpcHttpResponse,
  mockClientHttpFetch,
  waitForAssertion,
} from "./client-http-test-helpers.js";

describe("MCP HTTP redirect policy", () => {
  let client: McpClient | null = null;

  afterEach(async () => {
    if (client) await client.close();
    client = null;
    vi.restoreAllMocks();
  });

  it("rejects cross-origin redirects before replaying JSON-RPC bodies and credentials", async () => {
    const fetch = mockClientHttpFetch(() =>
      new Response(null, {
        status: 307,
        headers: { location: "http://127.0.0.1/internal" },
      }));
    client = new McpClient(
      {
        type: "http",
        url: "https://mcp.example.test/mcp",
        headers: { Authorization: "Bearer configured-secret" },
      },
      "redirecting-http-client",
    );

    await expect(client.connect()).rejects.toThrow(
      /redirect-denied: cross-origin redirect would replay a request body or state-changing method/,
    );
    expect(fetch.requests.map(({ url }) => url)).toEqual([
      "https://mcp.example.test/mcp",
    ]);
  });

  it("revalidates protected-resource metadata redirects before private-network access", async () => {
    const fetch = mockClientHttpFetch((request) => {
      if (request.method === "GET") {
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/oauth-metadata" },
        });
      }
      return new Response("missing bearer", {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read"',
        },
      });
    });
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "private-metadata-redirect-client",
    );

    await expect(client.connect()).rejects.toMatchObject({
      challenge: {
        metadataDiscovery: {
          status: "unavailable",
          error: expect.stringMatching(
            /target-denied: target origin http:\/\/127\.0\.0\.1\/? is not selected/,
          ),
        },
      },
    });
    expect(fetch.requests.map(({ url }) => url)).toEqual([
      "https://mcp.example.test/mcp",
      "https://mcp.example.test/.well-known/oauth-protected-resource/mcp",
    ]);
  });

  it("rejects subscription redirects before replaying the listen request", async () => {
    const stderr: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
    const fetch = mockClientHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: "redirecting-subscription-fixture" },
        });
      }
      return new Response(null, {
        status: 307,
        headers: { location: "http://127.0.0.1/subscription" },
      });
    });
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "redirecting-subscription-client",
    );

    await client.connect();
    await waitForAssertion(() => {
      expect(stderr.join("")).toMatch(
        /failed to open subscription: redirect-denied: cross-origin redirect would replay a request body or state-changing method/,
      );
    });
    expect(fetch.requests.map(({ url }) => url)).toEqual([
      "https://mcp.example.test/mcp",
      "https://mcp.example.test/mcp",
    ]);
  });
});
