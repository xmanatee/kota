import { describe, expect, it, vi } from "vitest";
import { antigravityCliAuthReadiness } from "./auth-readiness.js";

describe("Antigravity CLI auth readiness", () => {
  it("rejects macOS Keychain-backed auth before probing AGY", () => {
    const readCommandOutput = vi.fn();
    const readiness = antigravityCliAuthReadiness(
      {
        resolveBinary: () => ({
          status: "ready",
          executablePath: "/opt/bin/agy",
        }),
        readCommandVersion: () => ({ status: "error", detail: "not used" }),
        readCommandOutput,
        readPackageVersion: () => ({ status: "error", detail: "not used" }),
      },
      { env: { HOME: "/operator" }, platform: "darwin" },
    );

    expect(readiness).toMatchObject({
      status: "error",
      required: true,
      summary: "Antigravity CLI provider auth broker unavailable",
      detail: expect.stringContaining("auto-approved native tool process tree"),
    });
    expect(readCommandOutput).not.toHaveBeenCalled();
  });
});
