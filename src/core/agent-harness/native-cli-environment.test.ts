import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildIsolatedNativeCliEnvironment,
  buildNativeCliEnvironment,
} from "./native-cli-environment.js";

describe("native CLI child environment", () => {
  it("inherits only executable and locale state plus harness-declared authentication", () => {
    const env = buildNativeCliEnvironment({
      inheritedEnv: {
        PATH: "/usr/bin:/bin",
        LANG: "en_GB.UTF-8",
        LC_CTYPE: "UTF-8",
        TERM: "xterm-256color",
        HOME: "/operator",
        CODEX_HOME: "/operator/.codex",
        OPENAI_API_KEY: "openai-secret",
        ANTHROPIC_API_KEY: "anthropic-secret",
        GH_TOKEN: "github-secret",
        SLACK_BOT_TOKEN: "notification-secret",
        AWS_SECRET_ACCESS_KEY: "cloud-secret",
        GOOGLE_APPLICATION_CREDENTIALS: "/operator/gcp.json",
        CI: "false",
      },
      projectedEnvKeys: ["CODEX_HOME", "CI"],
      overrides: {
        KOTA_RUN_DIR: "/project/.kota/run",
      },
    });

    expect(env).toMatchObject({
      CI: "true",
      GIT_OPTIONAL_LOCKS: "0",
      KOTA_RUN_DIR: "/project/.kota/run",
      PATH: "/usr/bin:/bin",
      LANG: "en_GB.UTF-8",
      LC_CTYPE: "UTF-8",
      CODEX_HOME: "/operator/.codex",
    });
    expect(env).not.toHaveProperty("TERM");
    expect(env).not.toHaveProperty("HOME");
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env).not.toHaveProperty("GH_TOKEN");
    expect(env).not.toHaveProperty("SLACK_BOT_TOKEN");
    expect(env).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
    expect(env).not.toHaveProperty("GOOGLE_APPLICATION_CREDENTIALS");
  });

  it("keeps explicit runtime additions but rejects undeclared credential material", () => {
    expect(buildNativeCliEnvironment({
      inheritedEnv: { PATH: "/usr/bin" },
      overrides: {
        KOTA_RUN_DIR: "/project/.kota/run",
        KOTA_PORT_BASE: "41000",
        GEMINI_API_KEY: "gemini-secret",
      },
      authenticationEnvKeys: ["GEMINI_API_KEY"],
    })).toMatchObject({
      PATH: "/usr/bin",
      KOTA_RUN_DIR: "/project/.kota/run",
      KOTA_PORT_BASE: "41000",
      GEMINI_API_KEY: "gemini-secret",
    });

    expect(() => buildNativeCliEnvironment({
      inheritedEnv: { PATH: "/usr/bin" },
      overrides: { GH_TOKEN: "github-secret" },
    })).toThrow(/credential-shaped environment variable "GH_TOKEN"/);
  });

  it("uses invocation-scoped user-home and temporary-directory locators", () => {
    const invocationRoot = "/private/tmp/kota-native-cli-run";
    const env = buildIsolatedNativeCliEnvironment({
      HOME: "/operator",
      USERPROFILE: "C:\\Users\\operator",
      XDG_CONFIG_HOME: "/operator/.config",
      TMPDIR: "/operator/tmp",
      PATH: "/usr/bin",
    }, invocationRoot);

    expect(env).toMatchObject({
      HOME: join(invocationRoot, "home"),
      USERPROFILE: join(invocationRoot, "home"),
      XDG_CONFIG_HOME: join(invocationRoot, "home", ".config"),
      XDG_CACHE_HOME: join(invocationRoot, "home", ".cache"),
      XDG_DATA_HOME: join(invocationRoot, "home", ".local", "share"),
      XDG_STATE_HOME: join(invocationRoot, "home", ".local", "state"),
      TMPDIR: invocationRoot,
      TMP: invocationRoot,
      TEMP: invocationRoot,
      PATH: "/usr/bin",
      CI: "true",
      GIT_OPTIONAL_LOCKS: "0",
    });
  });
});
