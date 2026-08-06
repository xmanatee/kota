import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import { getPreset } from "#core/model/preset.js";
import {
  collectPresetHarnessReadiness,
  isPresetHarnessReadinessReady,
} from "#core/model/preset-readiness.js";
import { geminiCliAgentHarness } from "./adapter.js";
import { geminiCliAuthReadiness } from "./auth-readiness.js";

function restoreEnvVar(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function withTemporaryHome<T>(callback: () => T): T {
  const home = mkdtempSync(join(tmpdir(), "kota-gemini-cli-auth-"));
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const previousGeminiApiKey = process.env.GEMINI_API_KEY;
  const previousGoogleApiKey = process.env.GOOGLE_API_KEY;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  try {
    return callback();
  } finally {
    restoreEnvVar("HOME", previousHome);
    restoreEnvVar("USERPROFILE", previousUserProfile);
    restoreEnvVar("GEMINI_API_KEY", previousGeminiApiKey);
    restoreEnvVar("GOOGLE_API_KEY", previousGoogleApiKey);
    rmSync(home, { recursive: true, force: true });
  }
}

function writeGeminiCache(
  home: string,
  fileName: "oauth_creds.json" | "google_accounts.json",
  contents: string,
): void {
  const geminiDir = join(home, ".gemini");
  mkdirSync(geminiDir, { recursive: true });
  writeFileSync(join(geminiDir, fileName), contents);
}

afterEach(() => {
  clearAgentHarnessRegistryForTest();
});

describe("Gemini CLI auth readiness", () => {
  it("reports missing local Gemini CLI login as failed harness-managed preset readiness", () => {
    withTemporaryHome(() => {
      registerAgentHarness(geminiCliAgentHarness);

      const readiness = collectPresetHarnessReadiness(getPreset("gemini-cli"));

      expect(readiness.adapter.localAuth).toMatchObject({
        kind: "harness-managed-login",
        status: "missing",
        required: true,
        command: "gemini",
        summary: "Gemini CLI provider auth broker unavailable",
      });
      expect(readiness.auth).toMatchObject({
        mode: "harness-managed-login",
        ready: false,
        missing: [],
        probe: {
          status: "missing",
          command: "gemini",
        },
        summary:
          "harness-managed auth not ready (Gemini CLI provider auth broker unavailable)",
      });
      expect(isPresetHarnessReadinessReady(readiness)).toBe(false);
    });
  });

  it("rejects refreshable cached OAuth credentials without a provider broker", () => {
    withTemporaryHome(() => {
      writeGeminiCache(
        process.env.HOME!,
        "oauth_creds.json",
        JSON.stringify({
          access_token: "redacted-access-token",
          refresh_token: "redacted-refresh-token",
          expiry_date: Date.parse("2026-06-21T23:00:00.000Z"),
        }),
      );

      const readiness = geminiCliAuthReadiness();

      expect(readiness).toMatchObject({
        status: "error",
        detail:
          "cached Gemini CLI OAuth credentials were detected, but KOTA cannot project them into the native tool process tree without a provider-only broker",
        summary: "Gemini CLI provider auth broker unavailable",
      });
      expect(readiness).not.toHaveProperty("expiresAt");
    });
  });

  it("rejects non-refreshable cached OAuth credentials without a provider broker", () => {
    withTemporaryHome(() => {
      writeGeminiCache(
        process.env.HOME!,
        "oauth_creds.json",
        JSON.stringify({
          access_token: "redacted-access-token",
          expiry_date: Date.parse("2026-06-22T02:00:00.000Z"),
        }),
      );

      const readiness = geminiCliAuthReadiness();

      expect(readiness).toMatchObject({
        status: "error",
        detail:
          "cached Gemini CLI OAuth credentials were detected, but KOTA cannot project them into the native tool process tree without a provider-only broker",
        summary: "Gemini CLI provider auth broker unavailable",
      });
    });
  });

  it("does not expose cached OAuth values in the broker failure", () => {
    withTemporaryHome(() => {
      writeGeminiCache(
        process.env.HOME!,
        "oauth_creds.json",
        JSON.stringify({
          access_token: "redacted-access-token",
          expiry_date: Date.parse("2026-06-22T00:30:00.000Z"),
        }),
      );

      const readiness = geminiCliAuthReadiness();

      expect(readiness).toMatchObject({
        status: "error",
        detail:
          "cached Gemini CLI OAuth credentials were detected, but KOTA cannot project them into the native tool process tree without a provider-only broker",
        summary: "Gemini CLI provider auth broker unavailable",
      });
      expect(readiness.detail).not.toContain("redacted-access-token");
    });
  });

  it("rejects expired cached OAuth material before launch too", () => {
    withTemporaryHome(() => {
      writeGeminiCache(
        process.env.HOME!,
        "oauth_creds.json",
        JSON.stringify({
          access_token: "redacted-access-token",
          expiry_date: Date.parse("2026-06-21T23:59:00.000Z"),
        }),
      );

      const readiness = geminiCliAuthReadiness();

      expect(readiness).toMatchObject({
        status: "error",
        detail:
          "cached Gemini CLI OAuth credentials were detected, but KOTA cannot project them into the native tool process tree without a provider-only broker",
        summary: "Gemini CLI provider auth broker unavailable",
      });
      expect(readiness.detail).not.toContain("redacted-access-token");
    });
  });

  it("reports malformed cached OAuth credentials as an auth probe error", () => {
    withTemporaryHome(() => {
      writeGeminiCache(
        process.env.HOME!,
        "oauth_creds.json",
        "{ not json",
      );

      const readiness = geminiCliAuthReadiness();

      expect(readiness).toMatchObject({
        status: "error",
        summary: "Gemini CLI cached auth probe failed",
      });
      expect(readiness.detail).toContain(
        "failed to read cached Gemini CLI OAuth credentials",
      );
    });
  });

  it("reports missing Gemini CLI cache as missing auth", () => {
    withTemporaryHome(() => {
      const readiness = geminiCliAuthReadiness();

      expect(readiness).toMatchObject({
        status: "missing",
        detail: "no brokered Gemini CLI provider authentication is available",
        summary: "Gemini CLI provider auth broker unavailable",
      });
    });
  });

  it("rejects provider API keys without exposing their values", () => {
    withTemporaryHome(() => {
      const readiness = geminiCliAuthReadiness({
        env: { GEMINI_API_KEY: "provider-secret" },
      });

      expect(readiness).toMatchObject({
        status: "error",
        detail: expect.stringContaining("GEMINI_API_KEY"),
        summary: "Gemini CLI provider auth broker unavailable",
      });
      expect(readiness.detail).not.toContain("provider-secret");
    });
  });
});
