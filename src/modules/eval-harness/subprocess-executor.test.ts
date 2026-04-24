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
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSubprocessExecutor } from "./subprocess-executor.js";

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
