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
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    return callback();
  } finally {
    restoreEnvVar("HOME", previousHome);
    restoreEnvVar("USERPROFILE", previousUserProfile);
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

      const readiness = collectPresetHarnessReadiness(getPreset("gemini-cli"), {
        now: () => new Date("2026-06-22T00:00:00.000Z"),
      });

      expect(readiness.adapter.localAuth).toMatchObject({
        kind: "harness-managed-login",
        status: "missing",
        required: true,
        command: "gemini",
        summary: "Gemini CLI login not active; run `gemini` and sign in",
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
          "harness-managed auth not ready (Gemini CLI login not active; run `gemini` and sign in)",
      });
      expect(isPresetHarnessReadinessReady(readiness)).toBe(false);
    });
  });

  it("reports refreshable cached OAuth credentials as ready even when the access token is expired", () => {
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

      const readiness = geminiCliAuthReadiness({
        now: () => new Date("2026-06-22T00:00:00.000Z"),
      });

      expect(readiness).toMatchObject({
        status: "ready",
        detail:
          "cached OAuth refresh token found at ~/.gemini/oauth_creds.json",
        summary: "Gemini CLI Google login cached with refresh token",
      });
      expect(readiness).not.toHaveProperty("expiresAt");
    });
  });

  it("reports unexpired non-refreshable cached OAuth credentials as ready", () => {
    withTemporaryHome(() => {
      writeGeminiCache(
        process.env.HOME!,
        "oauth_creds.json",
        JSON.stringify({
          access_token: "redacted-access-token",
          expiry_date: Date.parse("2026-06-22T02:00:00.000Z"),
        }),
      );

      const readiness = geminiCliAuthReadiness({
        now: () => new Date("2026-06-22T00:00:00.000Z"),
      });

      expect(readiness).toMatchObject({
        status: "ready",
        detail:
          "cached non-refreshable OAuth access token expires at 2026-06-22T02:00:00.000Z",
        summary: "Gemini CLI Google login cached",
      });
    });
  });

  it("warns for near-expiry non-refreshable cached OAuth credentials", () => {
    withTemporaryHome(() => {
      writeGeminiCache(
        process.env.HOME!,
        "oauth_creds.json",
        JSON.stringify({
          access_token: "redacted-access-token",
          expiry_date: Date.parse("2026-06-22T00:30:00.000Z"),
        }),
      );

      const readiness = geminiCliAuthReadiness({
        now: () => new Date("2026-06-22T00:00:00.000Z"),
      });

      expect(readiness).toMatchObject({
        status: "expiring",
        expiresAt: "2026-06-22T00:30:00.000Z",
        renewalSummary:
          "run `gemini` and sign in again before unattended runs",
        detail:
          "cached non-refreshable OAuth access token expires at 2026-06-22T00:30:00.000Z",
        summary: "Gemini CLI Google login expires soon",
      });
      expect(readiness.detail).not.toContain("redacted-access-token");
    });
  });

  it("reports expired non-refreshable cached OAuth credentials as stale", () => {
    withTemporaryHome(() => {
      writeGeminiCache(
        process.env.HOME!,
        "oauth_creds.json",
        JSON.stringify({
          access_token: "redacted-access-token",
          expiry_date: Date.parse("2026-06-21T23:59:00.000Z"),
        }),
      );

      const readiness = geminiCliAuthReadiness({
        now: () => new Date("2026-06-22T00:00:00.000Z"),
      });

      expect(readiness).toMatchObject({
        status: "stale",
        expiredAt: "2026-06-21T23:59:00.000Z",
        renewalSummary:
          "run `gemini` and sign in again before unattended runs",
        detail:
          "cached non-refreshable OAuth access token expired at 2026-06-21T23:59:00.000Z",
        summary: "Gemini CLI cached auth expired",
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

      const readiness = geminiCliAuthReadiness({
        now: () => new Date("2026-06-22T00:00:00.000Z"),
      });

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
      const readiness = geminiCliAuthReadiness({
        now: () => new Date("2026-06-22T00:00:00.000Z"),
      });

      expect(readiness).toMatchObject({
        status: "missing",
        detail:
          "no cached Gemini CLI Google OAuth / Code Assist credentials found under ~/.gemini",
        summary: "Gemini CLI login not active; run `gemini` and sign in",
      });
    });
  });
});
