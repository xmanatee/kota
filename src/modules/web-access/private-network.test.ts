import { lookup } from "node:dns/promises";
import { describe, expect, it, vi } from "vitest";
import { validatePublicWebAccessUrl } from "./private-network.js";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

const mockLookup = vi.mocked(lookup);

describe("validatePublicWebAccessUrl", () => {
  it.each([
    "http://[fec0::1]/",
    "http://[ff02::1]/",
    "http://[100::1]/",
    "http://[2001:db8::1]/",
    "http://[3fff::1]/",
  ])("rejects non-public IPv6 literal %s", async (url) => {
    const result = await validatePublicWebAccessUrl(url);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("loopback/private-network");
    }
  });

  it.each([
    "fec0::1",
    "ff02::1",
  ])("rejects hostnames that resolve to non-public IPv6 address %s", async (address) => {
    mockLookup.mockResolvedValueOnce([{ address, family: 6 }] as never);

    const result = await validatePublicWebAccessUrl("https://example.test/status");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(`example.test -> ${address}`);
    }
  });

  it("accepts global IPv6 literals", async () => {
    const result = await validatePublicWebAccessUrl("https://[2606:4700:4700::1111]/");

    expect(result).toEqual({ ok: true });
  });
});
