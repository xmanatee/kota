import { describe, expect, it } from "vitest";
import { resolveBrowserProfileConfig } from "./config.js";

describe("browser network profile config", () => {
  it("defaults every browser session to public-untrusted", () => {
    expect(resolveBrowserProfileConfig({}).networkProfile).toEqual({
      name: "public-untrusted",
    });
  });

  it("accepts an explicit public-untrusted selection", () => {
    expect(
      resolveBrowserProfileConfig({
        networkProfile: { name: "public-untrusted" },
      }).networkProfile,
    ).toEqual({ name: "public-untrusted" });
  });

  it("normalizes explicitly selected configured-provider origins", () => {
    expect(
      resolveBrowserProfileConfig({
        networkProfile: {
          name: "configured-provider",
          allowedOrigins: ["http://private.example:8080/path"],
        },
      }).networkProfile,
    ).toEqual({
      name: "configured-provider",
      allowedOrigins: ["http://private.example:8080"],
    });
  });

  it("fails closed on malformed or empty private-target selections", () => {
    expect(() =>
      resolveBrowserProfileConfig({
        networkProfile: {
          name: "configured-provider",
          allowedOrigins: [],
        },
      }),
    ).toThrow(/requires at least one origin/);
    expect(() =>
      resolveBrowserProfileConfig({
        networkProfile: {
          name: "configured-provider",
          allowedOrigins: ["file:///private"],
        },
      }),
    ).toThrow(/must use http:\/\/ or https:\/\//);
  });
});
