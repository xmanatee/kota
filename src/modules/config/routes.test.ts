import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { KotaConfig } from "#core/config/config.js";
import { handleGetConfig, maskConfig } from "./routes.js";

function mockResponse() {
  const result = { status: 0, body: null as unknown };
  const res = {
    setHeader: vi.fn(),
    writeHead: (s: number) => { result.status = s; },
    end: (data: string) => { result.body = JSON.parse(data); },
    on: vi.fn(),
  } as unknown as ServerResponse;
  return { res, result };
}

function makeConfig(overrides: Partial<KotaConfig> = {}): KotaConfig {
  return { model: "claude-test", ...overrides } as KotaConfig;
}

describe("maskConfig", () => {
  it("passes through non-sensitive keys unchanged", () => {
    const config = makeConfig({ model: "claude-opus" });
    const masked = maskConfig(config) as Record<string, unknown>;
    expect(masked.model).toBe("claude-opus");
  });

  it("masks top-level keys matching sensitive pattern", () => {
    const config = makeConfig({
      anthropicApiKey: "sk-real-key",
    } as Partial<KotaConfig>);
    const masked = maskConfig(config) as Record<string, unknown>;
    expect(masked.anthropicApiKey).toBe("***");
  });

  it("masks nested sensitive keys", () => {
    const config = { model: "claude-test", provider: { apiKey: "secret123", model: "claude" } } as unknown as KotaConfig;
    const masked = maskConfig(config) as Record<string, unknown>;
    const provider = masked.provider as Record<string, unknown>;
    expect(provider.apiKey).toBe("***");
    expect(provider.model).toBe("claude");
  });

  it("masks sensitive keys inside arrays of objects", () => {
    const config = {
      model: "claude-test",
      items: [{ name: "x", token: "tok123" }],
    } as unknown as KotaConfig;
    const masked = maskConfig(config) as Record<string, unknown>;
    const items = masked.items as Array<Record<string, unknown>>;
    expect(items[0].name).toBe("x");
    expect(items[0].token).toBe("***");
  });

  it("masks keys containing 'password' and 'secret'", () => {
    const config = {
      model: "claude-test",
      dbPassword: "hunter2",
      webhookSecret: "my-secret",
    } as unknown as KotaConfig;
    const masked = maskConfig(config) as Record<string, unknown>;
    expect(masked.dbPassword).toBe("***");
    expect(masked.webhookSecret).toBe("***");
  });

  it("masks authorization and credential-shaped keys", () => {
    const config = {
      model: "claude-test",
      mcp: {
        servers: {
          files: {
            authorization: "Bearer mcp-token",
            headers: [{ Authorization: "Bearer header-token" }],
            oauth: {
              clientSecret: "oauth-secret",
              refreshToken: "refresh-token",
            },
          },
        },
      },
      cookieJar: "session-cookie",
      credentialRef: "cred-ref",
    } as unknown as KotaConfig;

    const masked = maskConfig(config) as Record<string, unknown>;
    const serialized = JSON.stringify(masked);

    expect(serialized).not.toContain("Bearer mcp-token");
    expect(serialized).not.toContain("Bearer header-token");
    expect(serialized).not.toContain("oauth-secret");
    expect(serialized).not.toContain("refresh-token");
    expect(serialized).not.toContain("session-cookie");
    expect(serialized).not.toContain("cred-ref");
    expect(serialized).toContain('"authorization":"***"');
    expect(serialized).toContain('"Authorization":"***"');
    expect(masked.cookieJar).toBe("***");
    expect(masked.credentialRef).toBe("***");
  });
});

describe("handleGetConfig", () => {
  it("returns 200 with masked config", () => {
    const { res, result } = mockResponse();
    const config = makeConfig({ model: "claude-haiku" });
    handleGetConfig(res, config);
    expect(result.status).toBe(200);
    const body = result.body as { config: Record<string, unknown> };
    expect(body.config.model).toBe("claude-haiku");
  });

  it("does not leak sensitive values in response", () => {
    const { res, result } = mockResponse();
    const config = { model: "claude-test", anthropicApiKey: "sk-real" } as unknown as KotaConfig;
    handleGetConfig(res, config);
    const body = result.body as { config: Record<string, unknown> };
    expect(body.config.anthropicApiKey).toBe("***");
    expect(body.config.anthropicApiKey).not.toBe("sk-real");
  });

  it("does not leak private-key-shaped module config in response", () => {
    const { res, result } = mockResponse();
    const config = {
      model: "claude-test",
      modules: {
        demo: {
          privateKeyPem: "-----BEGIN PRIVATE KEY-----",
          private_key: "private-key-material",
          signingKey: "signing-key-material",
          clientAssertion: "signed-client-assertion",
          teamKey: "OPS",
        },
      },
    } as unknown as KotaConfig;

    handleGetConfig(res, config);

    const serialized = JSON.stringify(result.body);
    expect(serialized).toContain("OPS");
    expect(serialized).not.toContain("-----BEGIN PRIVATE KEY-----");
    expect(serialized).not.toContain("private-key-material");
    expect(serialized).not.toContain("signing-key-material");
    expect(serialized).not.toContain("signed-client-assertion");
    expect(serialized).toContain('"privateKeyPem":"***"');
    expect(serialized).toContain('"private_key":"***"');
    expect(serialized).toContain('"signingKey":"***"');
    expect(serialized).toContain('"clientAssertion":"***"');
  });
});
