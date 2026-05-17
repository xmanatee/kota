/**
 * Focused tests for createSubprocessExecutor.
 *
 * The production executor invokes `kota workflow exec <name>` inside a
 * fixture's isolated working directory. These tests substitute a tiny
 * stand-in script for the kota binary so the subprocess contract — budget
 * timeout, clean-exit-but-no-run, non-zero exit — is exercised without
 * running the real module loader.
 */

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PRESET_ENV_VAR } from "#core/model/preset.js";
import { REPLAY_AGENT_HARNESS_NAME_ENV } from "./replay-harness.js";
import {
  createSubprocessExecutor,
  detectHostSubprocessResourceProfile,
} from "./subprocess-executor.js";

function writeFakeKotaScript(path: string, body: string): void {
  writeFileSync(path, body, "utf-8");
  chmodSync(path, 0o755);
}

function writeTerminalRun(
  workingDir: string,
  workflowName: string,
  runId: string,
  status: "success" | "failed",
): void {
  const runDir = join(workingDir, ".kota", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "metadata.json"),
    JSON.stringify({ id: runId, workflow: workflowName, status }),
  );
}

describe("createSubprocessExecutor", () => {
  let binariesDir: string;
  let workingDir: string;

  beforeEach(() => {
    binariesDir = mkdtempSync(join(tmpdir(), "kota-subprocess-bin-"));
    workingDir = mkdtempSync(join(tmpdir(), "kota-subprocess-work-"));
  });

  afterEach(() => {
    rmSync(binariesDir, { recursive: true, force: true });
    rmSync(workingDir, { recursive: true, force: true });
  });

  it("reports timeout when the child exceeds the fixture budget", async () => {
    const fakeKota = join(binariesDir, "kota-sleep.mjs");
    writeFakeKotaScript(
      fakeKota,
      "setInterval(() => {}, 1000);\n",
    );

    const executor = createSubprocessExecutor({ kotaBinaryPath: fakeKota });
    const outcome = await executor.execute({
      workflowName: "sleepy",
      workingDir,
      budgetMs: 200,
    });

    expect(outcome.kind).toBe("timeout");
    expect(outcome.runArtifactPath).toBeNull();
    expect(outcome.durationMs).toBeGreaterThanOrEqual(200);
  });

  it("reports error when the child exits cleanly without a run artifact", async () => {
    const fakeKota = join(binariesDir, "kota-silent.mjs");
    writeFakeKotaScript(fakeKota, "process.exit(0);\n");

    const executor = createSubprocessExecutor({ kotaBinaryPath: fakeKota });
    const outcome = await executor.execute({
      workflowName: "ghost",
      workingDir,
      budgetMs: 5_000,
    });

    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.message).toMatch(/no terminal run artifact/);
    }
  });

  it("reports completed when the child exits 0 and a terminal run exists", async () => {
    writeTerminalRun(workingDir, "noop", "run-1-noop-abc", "success");
    const fakeKota = join(binariesDir, "kota-success.mjs");
    writeFakeKotaScript(fakeKota, "process.exit(0);\n");

    const executor = createSubprocessExecutor({ kotaBinaryPath: fakeKota });
    const outcome = await executor.execute({
      workflowName: "noop",
      workingDir,
      budgetMs: 5_000,
    });

    expect(outcome.kind).toBe("completed");
    expect(outcome.runArtifactPath).toContain("run-1-noop-abc");
  });

  it("pins replay runs to the claude preset so recordings override the active harness", async () => {
    const fakeKota = join(binariesDir, "kota-env-capture.mjs");
    writeFakeKotaScript(
      fakeKota,
      [
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        "writeFileSync(join(process.cwd(), 'env.json'), JSON.stringify({",
        `  preset: process.env.${PRESET_ENV_VAR},`,
        `  replayRoot: process.env.${REPLAY_AGENT_HARNESS_NAME_ENV},`,
        "}));",
        "const runDir = join(process.cwd(), '.kota', 'runs', 'run-1-noop-replay');",
        "mkdirSync(runDir, { recursive: true });",
        "writeFileSync(join(runDir, 'metadata.json'), JSON.stringify({",
        "  id: 'run-1-noop-replay', workflow: 'noop', status: 'success',",
        "}));",
      ].join("\n"),
    );

    const executor = createSubprocessExecutor({
      kotaBinaryPath: fakeKota,
      extraEnv: { [PRESET_ENV_VAR]: "codex" },
    });
    const outcome = await executor.execute({
      workflowName: "noop",
      workingDir,
      budgetMs: 5_000,
      replayRecordingsRoot: "/fixtures/replay",
    });

    expect(outcome.kind).toBe("completed");
    const envCapture = JSON.parse(
      readFileSync(join(workingDir, "env.json"), "utf8"),
    ) as Record<string, string>;
    expect(envCapture.preset).toBe("claude");
    expect(envCapture.replayRoot).toBe("/fixtures/replay");
  });

  it("marks host subprocess preflight as explicit non-gating evidence", () => {
    const executor = createSubprocessExecutor({
      kotaBinaryPath: join(binariesDir, "unused.mjs"),
    });
    const requestedProfile = detectHostSubprocessResourceProfile("host-test");
    const preflight = executor.preflight(requestedProfile);

    expect(preflight.status).toBe("non-gating");
    expect(preflight.backendKind).toBe("host-subprocess");
    expect(preflight.gateEligible).toBe(false);
    if (preflight.status !== "non-gating") throw new Error("unreachable");
    expect(preflight.nonGatingReason).toBe("host-subprocess-unverified");
    expect(preflight.observedOrEnforcedProfile).toEqual(requestedProfile);
  });

  it("rejects requested resource profiles that do not match observed host facts", () => {
    const executor = createSubprocessExecutor({
      kotaBinaryPath: join(binariesDir, "unused.mjs"),
    });
    const observedProfile = detectHostSubprocessResourceProfile("host-test");
    const preflight = executor.preflight({
      ...observedProfile,
      cpuKillThresholdCores: observedProfile.cpuKillThresholdCores + 1,
    });

    expect(preflight.status).toBe("rejected");
    if (preflight.status !== "rejected") throw new Error("unreachable");
    expect(preflight.rejectionReason).toBe("requested-observed-mismatch");
  });

  it("reports a missing optional container backend as typed non-gating preflight", () => {
    const executor = createSubprocessExecutor({
      kotaBinaryPath: join(binariesDir, "unused.mjs"),
      isolationBackend: {
        kind: "container",
        executable: "kota-eval-missing-container-backend",
      },
    });
    const requestedProfile = detectHostSubprocessResourceProfile("host-test");
    const preflight = executor.preflight(requestedProfile);

    expect(preflight.status).toBe("non-gating");
    expect(preflight.backendKind).toBe("missing-isolation-backend");
    if (preflight.status !== "non-gating") throw new Error("unreachable");
    expect(preflight.nonGatingReason).toBe("isolation-backend-unavailable");
  });

  it("remaps HOME and KOTA_PROJECT_DIR inside the child process", async () => {
    const fakeKota = join(binariesDir, "kota-home-capture.mjs");
    writeFakeKotaScript(
      fakeKota,
      [
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        "writeFileSync(join(process.cwd(), 'env.json'), JSON.stringify({",
        "  home: process.env.HOME,",
        "  projectDir: process.env.KOTA_PROJECT_DIR,",
        "}));",
        "const runDir = join(process.cwd(), '.kota', 'runs', 'run-1-noop-env');",
        "mkdirSync(runDir, { recursive: true });",
        "writeFileSync(join(runDir, 'metadata.json'), JSON.stringify({",
        "  id: 'run-1-noop-env', workflow: 'noop', status: 'success',",
        "}));",
      ].join("\n"),
    );

    const executor = createSubprocessExecutor({ kotaBinaryPath: fakeKota });
    const outcome = await executor.execute({
      workflowName: "noop",
      workingDir,
      budgetMs: 5_000,
    });

    expect(outcome.kind).toBe("completed");
    const envCapture = JSON.parse(
      readFileSync(join(workingDir, "env.json"), "utf8"),
    ) as Record<string, string>;
    expect(envCapture.home).toBe(workingDir);
    expect(envCapture.projectDir).toBe(workingDir);
  });

  it("reports error when the child exits non-zero", async () => {
    writeTerminalRun(workingDir, "noop", "run-1-noop-fail", "failed");
    const fakeKota = join(binariesDir, "kota-fail.mjs");
    writeFakeKotaScript(fakeKota, "process.exit(3);\n");

    const executor = createSubprocessExecutor({ kotaBinaryPath: fakeKota });
    const outcome = await executor.execute({
      workflowName: "noop",
      workingDir,
      budgetMs: 5_000,
    });

    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.message).toMatch(/status 3/);
      expect(outcome.message).toMatch(/failed/);
    }
  });
});
