import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSubprocessExecutor } from "./subprocess-executor.js";
import {
  cleanupSubprocessTestDirs,
  createSubprocessTestDirs,
  type SubprocessTestDirs,
  writeFakeKotaScript,
} from "./subprocess-executor-test-helpers.js";

describe("createSubprocessExecutor abort handling", () => {
  let dirs: SubprocessTestDirs;

  beforeEach(() => {
    dirs = createSubprocessTestDirs();
  });

  afterEach(() => {
    cleanupSubprocessTestDirs(dirs);
  });

  it("terminates the active child when the owning execution aborts", async () => {
    const fakeKota = join(dirs.binariesDir, "kota-abort.mjs");
    writeFakeKotaScript(
      fakeKota,
      [
        "import { writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        "process.on('SIGTERM', () => {",
        "  writeFileSync(join(process.cwd(), 'aborted.txt'), 'aborted');",
        "  process.exit(0);",
        "});",
        "writeFileSync(join(process.cwd(), 'ready.txt'), 'ready');",
        "setInterval(() => {}, 1000);",
      ].join("\n"),
    );
    const abortController = new AbortController();
    const executor = createSubprocessExecutor({
      kotaBinaryPath: fakeKota,
      signal: abortController.signal,
    });
    const execution = executor.execute({
      workflowName: "abortable",
      workingDir: dirs.workingDir,
      budgetMs: 5_000,
    });

    await vi.waitFor(() => {
      expect(existsSync(join(dirs.workingDir, "ready.txt"))).toBe(true);
    });
    abortController.abort(new Error("cadence aborted"));

    await expect(execution).rejects.toThrow("cadence aborted");
    expect(readFileSync(join(dirs.workingDir, "aborted.txt"), "utf8")).toBe(
      "aborted",
    );
  });
});
