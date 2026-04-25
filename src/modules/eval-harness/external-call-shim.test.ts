import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EXTERNAL_CALL_LOG_SUBDIR,
  installExternalCallShims,
  SHIM_SUBDIR,
} from "./external-call-shim.js";

describe("installExternalCallShims", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "kota-eval-harness-shim-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("installs an executable shim per declared binary and reports the directories", () => {
    const result = installExternalCallShims(workDir, ["gh", "git-lfs"]);
    expect(result.shimDir).toBe(join(workDir, SHIM_SUBDIR));
    expect(result.logDir).toBe(join(workDir, EXTERNAL_CALL_LOG_SUBDIR));
    expect(result.binaries).toEqual(["gh", "git-lfs"]);
    for (const binary of result.binaries) {
      const shimPath = join(result.shimDir, binary);
      expect(existsSync(shimPath)).toBe(true);
      const mode = statSync(shimPath).mode & 0o777;
      // Owner-executable bit must be set on POSIX hosts so spawn() finds it.
      expect((mode & 0o100) !== 0).toBe(true);
    }
  });

  it("records argv + binary + exit code into the JSONL log when invoked", () => {
    const result = installExternalCallShims(workDir, ["gh"]);
    const ghShim = join(result.shimDir, "gh");
    const proc = spawnSync(process.execPath, [
      ghShim,
      "pr",
      "review",
      "42",
      "--approve",
      "--body",
      "LGTM",
    ]);
    expect(proc.status).toBe(0);
    const logPath = join(result.logDir, "gh.jsonl");
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]) as {
      binary: string;
      argv: string[];
      exitCode: number;
      timestamp: string;
    };
    expect(entry.binary).toBe("gh");
    expect(entry.argv).toEqual([
      "pr",
      "review",
      "42",
      "--approve",
      "--body",
      "LGTM",
    ]);
    expect(entry.exitCode).toBe(0);
    expect(typeof entry.timestamp).toBe("string");
  });

  it("appends a new entry per invocation rather than overwriting", () => {
    const result = installExternalCallShims(workDir, ["gh"]);
    const ghShim = join(result.shimDir, "gh");
    spawnSync(process.execPath, [ghShim, "pr", "view", "1"]);
    spawnSync(process.execPath, [ghShim, "pr", "review", "1", "--approve"]);
    const lines = readFileSync(join(result.logDir, "gh.jsonl"), "utf-8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);
    expect((JSON.parse(lines[0]) as { argv: string[] }).argv).toEqual([
      "pr",
      "view",
      "1",
    ]);
    expect((JSON.parse(lines[1]) as { argv: string[] }).argv).toEqual([
      "pr",
      "review",
      "1",
      "--approve",
    ]);
  });

  it("rejects binary names containing path separators or unsafe characters", () => {
    expect(() => installExternalCallShims(workDir, ["../evil"])).toThrow(
      /outside \[A-Za-z0-9/,
    );
    expect(() => installExternalCallShims(workDir, ["bin/with/slash"])).toThrow();
    expect(() => installExternalCallShims(workDir, ["with space"])).toThrow();
  });
});
