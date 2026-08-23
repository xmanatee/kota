import { describe, expect, it, vi } from "vitest";
import {
  OUTBOUND_HTTP_POLICY_MATRIX,
  OUTBOUND_HTTP_PROFILE_NAMES,
  OUTBOUND_HTTP_PROFILES,
  type OutboundHttpProfile,
  OutboundHttpTransport,
} from "#core/outbound-http/index.js";

const PUBLIC_ADDRESS = [{ address: "93.184.216.34", family: 4 as const }];

type ProfileCase = {
  name: string;
  profile: OutboundHttpProfile;
  allowedUrl: string;
  deniedUrl: string;
};

const PROFILE_CASES: ProfileCase[] = [
  {
    name: "public-untrusted",
    profile: OUTBOUND_HTTP_PROFILES.publicUntrusted,
    allowedUrl: "https://public.example/resource",
    deniedUrl: "http://127.0.0.1/private",
  },
  {
    name: "configured-provider",
    profile: OUTBOUND_HTTP_PROFILES.configuredProvider(["https://provider.example/base"]),
    allowedUrl: "https://provider.example/v1/messages",
    deniedUrl: "https://other.example/v1/messages",
  },
  {
    name: "oauth-protected-resource",
    profile: OUTBOUND_HTTP_PROFILES.oauthProtectedResource(["https://resource.example"]),
    allowedUrl: "https://resource.example/me",
    deniedUrl: "https://issuer.example/me",
  },
  {
    name: "oauth-metadata-endpoint",
    profile: OUTBOUND_HTTP_PROFILES.oauthMetadataEndpoint(["https://tokens.example"]),
    allowedUrl: "https://tokens.example/token",
    deniedUrl: "https://issuer.example/token",
  },
  {
    name: "daemon-loopback",
    profile: OUTBOUND_HTTP_PROFILES.daemonLoopback,
    allowedUrl: "http://127.0.0.1:43100/health",
    deniedUrl: "https://daemon.example/health",
  },
  {
    name: "explicit-callback",
    profile: OUTBOUND_HTTP_PROFILES.explicitCallback(["https://callback.example/hooks/kota?tenant=one"]),
    allowedUrl: "https://callback.example/hooks/kota?tenant=one",
    deniedUrl: "https://callback.example/hooks/kota?tenant=two",
  },
];

describe("outbound HTTP profiles", () => {
  it("exposes only the six closed profile names and complete policies", () => {
    expect(Object.keys(OUTBOUND_HTTP_POLICY_MATRIX)).toEqual(OUTBOUND_HTTP_PROFILE_NAMES);
    for (const name of OUTBOUND_HTTP_PROFILE_NAMES) {
      const policy = OUTBOUND_HTTP_POLICY_MATRIX[name];
      expect(policy.timeoutMs.default).toBeGreaterThan(0);
      expect(policy.timeoutMs.maximum).toBeGreaterThanOrEqual(policy.timeoutMs.default);
      expect(policy.responseBytes.default).toBeGreaterThan(0);
      expect(policy.responseBytes.maximum).toBeGreaterThanOrEqual(policy.responseBytes.default);
      expect(policy.redirects.crossOrigin).toBe("strip-to-safe-headers-and-reject-body-replay");
    }
  });

  it.each(PROFILE_CASES)("enforces the $name target rule", async ({ profile, allowedUrl, deniedUrl }) => {
    const dispatcher = vi.fn(async () => new Response("ok"));
    const transport = new OutboundHttpTransport({
      dispatcher,
      resolveAddresses: async () => PUBLIC_ADDRESS,
    });

    const allowed = await transport.request({
      profile,
      operation: "profile-fixture",
      url: allowedUrl,
    });
    expect(await allowed.response.text()).toBe("ok");

    await expect(
      transport.request({
        profile,
        operation: "profile-fixture",
        url: deniedUrl,
      }),
    ).rejects.toMatchObject({
      failure: { code: "target-denied", profile: profile.name },
    });
  });

  it("rejects a hostname when DNS returns any private address before dispatch", async () => {
    const dispatcher = vi.fn(async () => new Response("must not run"));
    const transport = new OutboundHttpTransport({
      dispatcher,
      resolveAddresses: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.8", family: 4 },
      ],
    });

    await expect(
      transport.request({
        profile: OUTBOUND_HTTP_PROFILES.publicUntrusted,
        operation: "dns-rebinding-fixture",
        url: "https://public.example/resource",
      }),
    ).rejects.toMatchObject({ failure: { code: "target-denied" } });
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it("rejects private OAuth metadata endpoints before credential-bearing dispatch", async () => {
    const dispatcher = vi.fn(async () => new Response("must not run"));
    const transport = new OutboundHttpTransport({
      dispatcher,
      resolveAddresses: async () => [{ address: "10.0.0.8", family: 4 }],
    });

    await expect(
      transport.request({
        profile: OUTBOUND_HTTP_PROFILES.oauthMetadataEndpoint([
          "https://tokens.example/token",
        ]),
        operation: "oauth-token-fixture",
        url: "https://tokens.example/token",
        method: "POST",
        headers: { Authorization: "Basic secret" },
        body: "grant_type=client_credentials",
      }),
    ).rejects.toMatchObject({
      failure: { code: "target-denied", profile: "oauth-metadata-endpoint" },
    });
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it("requires HTTPS when selecting an OAuth metadata endpoint origin", () => {
    expect(() =>
      OUTBOUND_HTTP_PROFILES.oauthMetadataEndpoint([
        "http://tokens.example/token",
      ])
    ).toThrow(/must use https/);
  });

  it("allows an explicitly configured OAuth origin to select a private target", async () => {
    const dispatcher = vi.fn(async () => new Response("ok"));
    const resolveAddresses = vi.fn(async () => [
      { address: "127.0.0.1", family: 4 as const },
    ]);
    const transport = new OutboundHttpTransport({
      dispatcher,
      resolveAddresses,
    });

    const result = await transport.request({
      profile: OUTBOUND_HTTP_PROFILES.oauthProtectedResource([
        "https://127.0.0.1",
      ]),
      operation: "configured-private-oauth-fixture",
      url: "https://127.0.0.1/token",
      method: "POST",
      headers: { Authorization: "Basic secret" },
      body: "grant_type=client_credentials",
    });

    expect(await result.response.text()).toBe("ok");
    expect(dispatcher).toHaveBeenCalledOnce();
    expect(resolveAddresses).not.toHaveBeenCalled();
  });

  it("fails closed when a caller requests limits above a profile maximum", async () => {
    const transport = new OutboundHttpTransport({
      dispatcher: async () => new Response("ok"),
    });
    await expect(
      transport.request({
        profile: OUTBOUND_HTTP_PROFILES.daemonLoopback,
        operation: "limit-fixture",
        url: "http://127.0.0.1:43100/health",
        limits: { timeoutMs: 30_001 },
      }),
    ).rejects.toMatchObject({ failure: { code: "invalid-request" } });
  });
});
