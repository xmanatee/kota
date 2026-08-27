import { describe, expect, it, vi } from "vitest";
import { antigravityCliAuthReadiness } from "./auth-readiness.js";

describe("Antigravity CLI auth readiness", () => {
  it("uses AGY's model catalog as the provider-auth readiness probe", () => {
    const readCommandOutput = vi.fn().mockReturnValue({
      status: "ready",
      output: "gemini-3.7-flash-high",
    });
    const readiness = antigravityCliAuthReadiness({
      resolveBinary: () => ({
        status: "ready",
        executablePath: "/opt/bin/agy",
      }),
      readCommandVersion: () => ({ status: "error", detail: "not used" }),
      readCommandOutput,
      readPackageVersion: () => ({ status: "error", detail: "not used" }),
    });

    expect(readiness).toMatchObject({
      status: "ready",
      required: true,
      summary: "Antigravity CLI login and model access ready",
    });
    expect(readCommandOutput).toHaveBeenCalledWith("/opt/bin/agy", ["models"]);
  });
});
