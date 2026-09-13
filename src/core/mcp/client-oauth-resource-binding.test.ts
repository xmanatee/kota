import { afterEach, describe, expect, it, vi } from "vitest";
import { MCP_CURRENT_PROTOCOL_VERSION, McpClient, mcpOAuthSecret } from "./client.js";
import type { McpAuthorizationResolverRequest } from "./client-auth-types.js";
import { jsonRpcHttpResponse, mockClientHttpFetch } from "./client-http-test-helpers.js";

const resource = "https://mcp.example.test/mcp";
const issuer = "https://auth.example.test";
const resourceMetadataUrl = "https://mcp.example.test/.well-known/oauth-protected-resource/mcp";
const redirectUri = "https://client.example.test/callback";

function json(value: object): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}

describe("MCP authorization-code resource binding", () => {
  let client: McpClient;

  afterEach(async () => {
    await client?.close();
    vi.restoreAllMocks();
  });

  function peer(advertisedResource: string) {
    const metadata = { resource: advertisedResource };
    let challengeAuthenticatedRequests = false;
    const resolver = vi.fn(async (request: McpAuthorizationResolverRequest) => ({
      callbackUrl: mcpOAuthSecret(`${redirectUri}?code=synthetic-code&state=${request.state}`),
    }));
    const http = mockClientHttpFetch((request) => {
      if (request.url === resourceMetadataUrl) {
        return json({ ...metadata, authorization_servers: [issuer] });
      }
      if (request.url === `${issuer}/.well-known/oauth-authorization-server`) {
        return json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          code_challenge_methods_supported: ["S256"],
        });
      }
      if (request.url === `${issuer}/token`) {
        const refresh = request.form.get("grant_type") === "refresh_token";
        return json({
          access_token: refresh ? "synthetic-refreshed-token" : "synthetic-access-token",
          refresh_token: "synthetic-refresh-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      if (request.url === resource) {
        if (!request.headers.has("authorization") || challengeAuthenticatedRequests) {
          return new Response(null, {
            status: 401,
            headers: {
              "www-authenticate": `Bearer resource_metadata="${resourceMetadataUrl}", scope="files:read files:write"`,
            },
          });
        }
        return jsonRpcHttpResponse(request.body.id, request.body.method === "server/discover"
          ? { supportedVersions: [MCP_CURRENT_PROTOCOL_VERSION], capabilities: { tools: {} } }
          : { tools: [] });
      }
      throw new Error(`Unexpected request ${request.url}`);
    });
    client = new McpClient({
      type: "http",
      url: resource,
      authorization: {
        type: "oauth",
        issuer,
        redirectUri,
        scopes: ["files:read"],
        client: { kind: "registered", clientId: "kota-client" },
      },
    }, "resource-binding-peer", { authorizationResolver: resolver });
    return {
      http,
      resolver,
      changeResource(value: string) {
        metadata.resource = value;
        challengeAuthenticatedRequests = true;
      },
    };
  }

  it.each([
    "https://victim.example.test/api",
    "https://mcp.example.test/other-service",
    "https://mcp.example.test/mcp/child",
    "https://mcp.example.test:8443/mcp",
    "https://mcp.example.test/mcp?audience=victim",
  ])("rejects peer-selected audience %s before authorization or bearer delivery", async (audience) => {
    const { http, resolver } = peer(audience);
    await expect(client.connect()).rejects.toThrow(/resource does not match configured MCP HTTP URL/);
    expect(resolver).not.toHaveBeenCalled();
    expect(http.requests.map(({ url }) => url)).toEqual([resource, resourceMetadataUrl]);
    expect(http.requests.every(({ headers }) => !headers.has("authorization"))).toBe(true);
  });

  it("keeps the configured audience through consent, exchange, refresh and bearer dispatch", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const { http, resolver, changeResource } = peer("https://MCP.EXAMPLE.TEST:443/mcp");
    await client.connect();
    const request = resolver.mock.calls[0][0];
    expect(request.resource).toBe(resource);
    expect(new URL(request.authorizationUrl).searchParams.get("resource")).toBe(resource);
    expect(request.scopes).toEqual(["files:read", "files:write"]);

    clock.mockReturnValue(now + 3_600_001);
    await expect(client.listTools()).resolves.toEqual([]);
    const forms = http.requests.filter(({ url }) => url === `${issuer}/token`).map(({ form }) => form);
    expect(forms.map((form) => form.get("grant_type"))).toEqual(["authorization_code", "refresh_token"]);
    expect(forms.map((form) => form.get("resource"))).toEqual([resource, resource]);
    expect(forms[1].get("refresh_token")).toBe("synthetic-refresh-token");
    expect(http.requests.filter(({ headers }) => headers.has("authorization"))
      .map(({ url, headers }) => [url, headers.get("authorization")])).toEqual([
      [resource, "Bearer synthetic-access-token"],
      [resource, "Bearer synthetic-refreshed-token"],
    ]);

    // A later challenge must not replace the established audience either.
    changeResource("https://victim.example.test/api");
    await expect(client.listTools()).rejects.toThrow(/resource does not match configured MCP HTTP URL/);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(http.requests.filter(({ url }) => url === `${issuer}/token`)).toHaveLength(2);
    expect(http.requests.at(-1)?.url).toBe(resourceMetadataUrl);
  });
});
