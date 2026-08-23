import { afterEach, describe, expect, it, vi } from "vitest";
import { McpClient } from "./client.js";
import { mockClientHttpFetch } from "./client-http-test-helpers.js";

const MCP_URL = "https://mcp.example.test/mcp";
const ISSUER = "https://auth.example.test";

function jsonResponse(value: Record<string, unknown>): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function clientCredentialsClient(issuer = ISSUER): McpClient {
  return new McpClient(
    {
      type: "http",
      url: MCP_URL,
      authorization: {
        type: "oauth-client-credentials",
        issuer,
        scopes: ["files:read"],
        tokenEndpointAuthMethod: "client_secret_basic",
        client: {
          kind: "registered",
          clientId: "kota-client",
          clientSecret: "client-secret",
        },
      },
    },
    "oauth-endpoint-policy-client",
  );
}

function mockAuthorizationMetadata(metadata: Record<string, unknown>) {
  return mockClientHttpFetch((request) => {
    if (
      request.method === "GET" &&
      request.url ===
        "https://mcp.example.test/.well-known/oauth-protected-resource/mcp"
    ) {
      return jsonResponse({
        resource: MCP_URL,
        authorization_servers: [ISSUER],
        scopes_supported: ["files:read"],
      });
    }
    if (
      request.method === "GET" &&
      request.url ===
        "https://auth.example.test/.well-known/oauth-authorization-server"
    ) {
      return jsonResponse({
        issuer: ISSUER,
        token_endpoint: "https://auth.example.test/token",
        token_endpoint_auth_methods_supported: ["client_secret_basic"],
        ...metadata,
      });
    }
    return new Response("missing token", {
      status: 401,
      headers: {
        "www-authenticate":
          'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read"',
      },
    });
  });
}

describe("MCP OAuth endpoint policy", () => {
  let client: McpClient | null = null;

  afterEach(async () => {
    if (client) await client.close();
    client = null;
    vi.restoreAllMocks();
  });

  it("rejects configured plain-HTTP OAuth and identity-provider issuers", () => {
    expect(() => clientCredentialsClient("http://auth.example.test")).toThrow(
      /OAuth issuer must use https/,
    );

    expect(
      () =>
        new McpClient({
          type: "http",
          url: MCP_URL,
          authorization: {
            type: "enterprise-managed",
            issuer: ISSUER,
            resource: MCP_URL,
            scopes: ["files:read"],
            identityProvider: {
              issuer: "http://idp.example.test",
              tokenEndpoint: "https://idp.example.test/token",
            },
            subjectToken: {
              tokenType: "urn:ietf:params:oauth:token-type:id_token",
              source: { kind: "static", token: "identity-assertion" },
            },
            tokenEndpointAuthMethod: "client_secret_basic",
            client: {
              kind: "registered",
              clientId: "kota-client",
              clientSecret: "client-secret",
            },
          },
        }),
    ).toThrow(/OAuth issuer must use https/);
  });

  it("rejects a configured plain-HTTP enterprise token endpoint", () => {
    expect(
      () =>
        new McpClient({
          type: "http",
          url: MCP_URL,
          authorization: {
            type: "enterprise-managed",
            issuer: ISSUER,
            resource: MCP_URL,
            scopes: ["files:read"],
            identityProvider: {
              issuer: "https://idp.example.test",
              tokenEndpoint: "http://idp.example.test/token",
            },
            subjectToken: {
              tokenType: "urn:ietf:params:oauth:token-type:id_token",
              source: { kind: "static", token: "identity-assertion" },
            },
            tokenEndpointAuthMethod: "client_secret_basic",
            client: {
              kind: "registered",
              clientId: "kota-client",
              clientSecret: "client-secret",
            },
          },
        }),
    ).toThrow(/identityProvider\.tokenEndpoint must use https/);
  });

  it.each([
    {
      field: "authorization_endpoint",
      endpoint: "http://authorization.example.test/authorize",
    },
    {
      field: "token_endpoint",
      endpoint: "http://tokens.example.test/token",
    },
    {
      field: "registration_endpoint",
      endpoint: "http://registration.example.test/register",
    },
  ])(
    "rejects metadata-derived remote HTTP $field before credential dispatch",
    async ({ field, endpoint }) => {
      const fetch = mockAuthorizationMetadata({ [field]: endpoint });
      client = clientCredentialsClient();

      await expect(client.connect()).rejects.toThrow(
        new RegExp(`${field} must use https`),
      );
      expect(fetch.requests.some(({ url }) => url === endpoint)).toBe(false);
      expect(
        fetch.requests.some(
          ({ headers }) => headers.get("authorization")?.startsWith("Basic ") === true,
        ),
      ).toBe(false);
    },
  );

  it("rejects a metadata-selected loopback token endpoint before credential dispatch", async () => {
    const endpoint = "https://127.0.0.1/token";
    const fetch = mockAuthorizationMetadata({ token_endpoint: endpoint });
    client = clientCredentialsClient();

    await expect(client.connect()).rejects.toThrow(
      /authorization-server metadata token_endpoint rejected: oauth-metadata-endpoint access to loopback\/private-network targets is blocked/,
    );
    expect(fetch.requests.some(({ url }) => url === endpoint)).toBe(false);
    expect(
      fetch.requests.some(
        ({ headers }) => headers.get("authorization")?.startsWith("Basic ") === true,
      ),
    ).toBe(false);
  });

  it.each(["authorization_endpoint", "registration_endpoint"])(
    "rejects a metadata-selected private %s before exposing or dispatching it",
    async (field) => {
      const endpoint = `https://127.0.0.1/${field}`;
      const fetch = mockAuthorizationMetadata({ [field]: endpoint });
      client = clientCredentialsClient();

      await expect(client.connect()).rejects.toThrow(
        new RegExp(
          `authorization-server metadata ${field} rejected: oauth-metadata-endpoint access to loopback/private-network targets is blocked`,
        ),
      );
      expect(fetch.requests.some(({ url }) => url === endpoint)).toBe(false);
    },
  );
});
