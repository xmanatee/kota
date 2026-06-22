import { mkdtempSync, rmSync } from "node:fs";
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
});
