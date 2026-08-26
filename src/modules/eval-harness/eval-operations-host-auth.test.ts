import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../codex-agent-harness/index.js";
import { executorExtraEnvForRun } from "./eval-run-execution.js";

describe("eval harness trusted-host auth environment", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "kota-eval-host-auth-"));
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("preserves the active Codex login locator without restoring operator HOME", () => {
    const env = executorExtraEnvForRun(
      workspaceRoot,
      { kind: "host-subprocess" },
      {
        HOME: "/operator",
        KOTA_PRESET: "codex",
      },
    );

    expect(env).toMatchObject({
      KOTA_PRESET: "codex",
      CODEX_HOME: "/operator/.codex",
    });
    expect(env.HOME).toBeUndefined();
  });

  it("resolves the OS account login when the Runtime Probe strips HOME", () => {
    const env = executorExtraEnvForRun(
      workspaceRoot,
      { kind: "host-subprocess" },
      {
        KOTA_PRESET: "codex",
      },
    );

    expect(env).toEqual({
      KOTA_PRESET: "codex",
      CODEX_HOME: join(homedir(), ".codex"),
    });
  });

  it("does not send a host login locator into a container", () => {
    const env = executorExtraEnvForRun(
      workspaceRoot,
      {
        kind: "container",
        executable: "docker",
        image: "kota-eval:test",
        kotaBinaryPath: "/opt/kota/bin/kota.mjs",
      },
      {
        HOME: "/operator",
        KOTA_PRESET: "codex",
      },
    );

    expect(env).toEqual({ KOTA_PRESET: "codex" });
  });
});
