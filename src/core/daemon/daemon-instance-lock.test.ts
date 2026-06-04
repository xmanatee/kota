import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONTROL_FILE, writeControlFile } from "./daemon-instance-lock.js";

const itPosix = process.platform === "win32" ? it.skip : it;

function fileMode(path: string): number {
  return statSync(path).mode & 0o777;
}

function withPermissiveUmask(action: () => void): void {
  const previousUmask = process.umask(0o000);
  try {
    action();
  } finally {
    process.umask(previousUmask);
  }
}

describe("writeControlFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kota-daemon-instance-lock-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  itPosix("creates the state directory and control file with restrictive POSIX modes", () => {
    const stateDir = join(tmpDir, ".kota");
    const controlPath = join(stateDir, CONTROL_FILE);

    withPermissiveUmask(() => {
      writeControlFile(stateDir, {
        port: 3921,
        pid: 12345,
        startedAt: "2026-06-04T10:00:00.000Z",
        token: "secret-token",
      });
    });

    expect(fileMode(stateDir)).toBe(0o700);
    expect(fileMode(controlPath)).toBe(0o600);
    expect(existsSync(`${controlPath}.tmp`)).toBe(false);
  });

  itPosix("tightens an existing permissive state directory and stale temp file", () => {
    const stateDir = join(tmpDir, ".kota");
    const controlPath = join(stateDir, CONTROL_FILE);
    const tmpPath = `${controlPath}.tmp`;

    withPermissiveUmask(() => {
      mkdirSync(stateDir, { mode: 0o777 });
      writeFileSync(tmpPath, "stale", { encoding: "utf-8", mode: 0o666 });
      chmodSync(stateDir, 0o777);

      writeControlFile(stateDir, {
        port: 3921,
        pid: 12345,
        startedAt: "2026-06-04T10:00:00.000Z",
        token: "secret-token",
      });
    });

    expect(fileMode(stateDir)).toBe(0o700);
    expect(fileMode(controlPath)).toBe(0o600);
    expect(existsSync(tmpPath)).toBe(false);
  });
});
