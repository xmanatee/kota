import { describe, expect, it, vi } from "vitest";
import { OUTBOUND_HTTP_PROFILES } from "#core/outbound-http/index.js";
import {
  resolveBrowserProxyConnectConnection,
  resolveBrowserProxyHttpConnection,
} from "./network-proxy.js";

const PUBLIC_ADDRESS = { address: "93.184.216.34", family: 4 as const };
const LOOPBACK_ADDRESS = { address: "127.0.0.1", family: 4 as const };

describe("browser connection-boundary proxy", () => {
  it.each([
    "http://127.0.0.1/private",
    "http://10.0.0.8/private",
    "http://169.254.169.254/latest/meta-data",
  ])("rejects non-public literal target %s", async (target) => {
    const resolveAddresses = vi.fn(async () => [PUBLIC_ADDRESS]);

    await expect(
      resolveBrowserProxyHttpConnection(
        target,
        OUTBOUND_HTTP_PROFILES.publicUntrusted,
        resolveAddresses,
      ),
    ).rejects.toThrow(/loopback\/private-network targets is blocked/);
    expect(resolveAddresses).not.toHaveBeenCalled();
  });

  it("rejects private DNS answers before opening the target socket", async () => {
    const resolveAddresses = vi.fn(async () => [
      { address: "192.168.1.20", family: 4 as const },
    ]);

    await expect(
      resolveBrowserProxyHttpConnection(
        "http://private-dns.example/article",
        OUTBOUND_HTTP_PROFILES.publicUntrusted,
        resolveAddresses,
      ),
    ).rejects.toThrow(/private-dns\.example -> 192\.168\.1\.20/);
    expect(resolveAddresses).toHaveBeenCalledOnce();
  });

  it("re-resolves HTTPS CONNECT at the socket boundary and rejects DNS rebinding", async () => {
    const resolveAddresses = vi
      .fn()
      .mockResolvedValueOnce([PUBLIC_ADDRESS])
      .mockResolvedValueOnce([LOOPBACK_ADDRESS]);

    await expect(
      resolveBrowserProxyConnectConnection(
        "rebind.example:443",
        OUTBOUND_HTTP_PROFILES.publicUntrusted,
        resolveAddresses,
      ),
    ).rejects.toThrow(/rebind\.example -> 127\.0\.0\.1/);
    expect(resolveAddresses).toHaveBeenCalledTimes(2);
  });

  it("applies the policy independently to redirect and subresource targets", async () => {
    const resolveAddresses = vi.fn(async (hostname: string) => [
      {
        address:
          hostname === "redirect.internal" ? "10.0.0.2" : "169.254.1.2",
        family: 4 as const,
      },
    ]);

    await expect(
      resolveBrowserProxyHttpConnection(
        "http://redirect.internal/landing",
        OUTBOUND_HTTP_PROFILES.publicUntrusted,
        resolveAddresses,
      ),
    ).rejects.toThrow(/10\.0\.0\.2/);
    await expect(
      resolveBrowserProxyHttpConnection(
        "http://asset.internal/script.js",
        OUTBOUND_HTTP_PROFILES.publicUntrusted,
        resolveAddresses,
      ),
    ).rejects.toThrow(/169\.254\.1\.2/);
    expect(resolveAddresses).toHaveBeenCalledWith("redirect.internal");
    expect(resolveAddresses).toHaveBeenCalledWith("asset.internal");
  });

  it("pins an explicitly selected configured-provider private origin", async () => {
    const resolveAddresses = vi.fn(async () => [LOOPBACK_ADDRESS]);
    const configured = OUTBOUND_HTTP_PROFILES.configuredProvider([
      "http://private.service:8080",
    ]);
    if (configured.name !== "configured-provider") {
      throw new Error("configured-provider profile did not resolve");
    }

    await expect(
      resolveBrowserProxyHttpConnection(
        "http://private.service:8080/article",
        configured,
        resolveAddresses,
      ),
    ).resolves.toMatchObject({
      address: LOOPBACK_ADDRESS,
      url: new URL("http://private.service:8080/article"),
    });
    await expect(
      resolveBrowserProxyHttpConnection(
        "http://other-private.service:8080/article",
        configured,
        resolveAddresses,
      ),
    ).rejects.toThrow(/not selected by the configured-provider profile/);
    expect(resolveAddresses).toHaveBeenCalledOnce();
  });

  it("pins explicitly selected private HTTPS CONNECT targets", async () => {
    const resolveAddresses = vi.fn(async () => [LOOPBACK_ADDRESS]);
    const configured = OUTBOUND_HTTP_PROFILES.configuredProvider([
      "https://private.service:8443",
    ]);
    if (configured.name !== "configured-provider") {
      throw new Error("configured-provider profile did not resolve");
    }

    await expect(
      resolveBrowserProxyConnectConnection(
        "private.service:8443",
        configured,
        resolveAddresses,
      ),
    ).resolves.toMatchObject({
      address: LOOPBACK_ADDRESS,
      port: 8443,
      url: new URL("https://private.service:8443/"),
    });
  });

  it("rejects URL credentials before connection", async () => {
    await expect(
      resolveBrowserProxyHttpConnection(
        "https://user:secret@public.example/",
        OUTBOUND_HTTP_PROFILES.publicUntrusted,
        async () => [PUBLIC_ADDRESS],
      ),
    ).rejects.toThrow(/must not contain URL credentials/);
  });
});
