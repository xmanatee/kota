import { afterEach, describe, expect, it, vi } from "vitest";
import { McpClient, mcpOAuthSecret } from "./client.js";
import { mockClientHttpFetch } from "./client-http-test-helpers.js";

function jsonResponse(value: Record<string, unknown>): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("MCP OAuth redirect policy", () => {
  let client: McpClient | null = null;

  afterEach(async () => {
    if (client) await client.close();
    client = null;
    vi.restoreAllMocks();
  });

  it("rejects token redirects before replaying form bodies and client credentials", async () => {
    const fetch = mockClientHttpFetch((request) => {
      if (
        request.method === "GET" &&
        request.url === "https://mcp.example.test/.well-known/oauth-protected-resource/mcp"
      ) {
        return jsonResponse({
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
          scopes_supported: ["files:read"],
        });
      }
      if (
        request.method === "GET" &&
        request.url === "https://auth.example.test/.well-known/oauth-authorization-server"
      ) {
        return jsonResponse({
          issuer: "https://auth.example.test",
          authorization_endpoint: "https://auth.example.test/authorize",
          token_endpoint: "https://auth.example.test/token",
          code_challenge_methods_supported: ["S256"],
          scopes_supported: ["files:read"],
          authorization_response_iss_parameter_supported: true,
        });
      }
      if (
        request.method === "POST" &&
        request.url === "https://auth.example.test/token"
      ) {
        return new Response(null, {
          status: 307,
          headers: { location: "http://127.0.0.1/token" },
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
      {
        type: "http",
        url: "https://mcp.example.test/mcp",
        authorization: {
          type: "oauth",
          issuer: "https://auth.example.test",
          redirectUri: "https://client.example.test/callback",
          scopes: ["files:read"],
          client: { kind: "registered", clientId: "kota-client" },
        },
      },
      "redirecting-oauth-client",
      {
        authorizationResolver: async (request) => ({
          callbackUrl: mcpOAuthSecret(
            `https://client.example.test/callback?code=code-1&state=${request.state}&iss=https%3A%2F%2Fauth.example.test`,
          ),
        }),
      },
    );

    await expect(client.connect()).rejects.toThrow(
      /token endpoint failed: redirect-denied: cross-origin redirect would replay a request body or state-changing method/,
    );
    expect(fetch.requests.map(({ url }) => url)).toEqual([
      "https://mcp.example.test/mcp",
      "https://mcp.example.test/.well-known/oauth-protected-resource/mcp",
      "https://auth.example.test/.well-known/oauth-authorization-server",
      "https://auth.example.test/token",
    ]);
  });
});
