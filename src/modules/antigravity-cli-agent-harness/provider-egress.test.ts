import { describe, expect, it } from "vitest";
import { NATIVE_CLI_EGRESS_UPSTREAM_PROXY_ENV } from "#core/agent-harness/native-cli-egress-proxy.js";
import { buildAntigravityCliEnvironment } from "./provider-egress.js";

describe("Antigravity CLI provider egress environment", () => {
  it("scopes declared Google auth only while the eval proxy seam is active", () => {
    const active = buildAntigravityCliEnvironment({
      inheritedEnv: {
        PATH: "/usr/bin",
        GOOGLE_API_KEY: "google-eval-key",
        GEMINI_API_KEY: "gemini-eval-key",
        [NATIVE_CLI_EGRESS_UPSTREAM_PROXY_ENV]:
          "http://provider-proxy:8080",
      },
      overrides: undefined,
      keychainDirectory: undefined,
    });

    expect(active).toMatchObject({
      GOOGLE_API_KEY: "google-eval-key",
      GEMINI_API_KEY: "gemini-eval-key",
      [NATIVE_CLI_EGRESS_UPSTREAM_PROXY_ENV]:
        "http://provider-proxy:8080",
    });

    const ordinary = buildAntigravityCliEnvironment({
      inheritedEnv: {
        PATH: "/usr/bin",
        GOOGLE_API_KEY: "must-not-cross",
      },
      overrides: undefined,
      keychainDirectory: undefined,
    });
    expect(ordinary.GOOGLE_API_KEY).toBeUndefined();
    expect(
      ordinary[NATIVE_CLI_EGRESS_UPSTREAM_PROXY_ENV],
    ).toBeUndefined();
  });
});
