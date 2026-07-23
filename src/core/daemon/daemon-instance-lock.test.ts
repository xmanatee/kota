import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isProcessAlive } from "#core/util/process-alive.js";
import { acquireInstanceLock, CONTROL_FILE, writeControlFile } from "./daemon-instance-lock.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn() };
});

vi.mock("#core/util/process-alive.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#core/util/process-alive.js")>();
  return { ...actual, isProcessAlive: vi.fn() };
});

const mockedExecFileSync = vi.mocked(execFileSync);
const mockedIsProcessAlive = vi.mocked(isProcessAlive);

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

describe("daemon instance lock", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kota-daemon-instance-lock-"));
  });

  afterEach(() => {
    mockedExecFileSync.mockReset();
    mockedIsProcessAlive.mockReset();
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("refuses to acquire the instance lock when daemon-state points at a live daemon without a control file", async () => {
    const stateDir = join(tmpDir, ".kota");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "daemon-state.json"),
      JSON.stringify({
        pid: 4242,
        startedAt: "2026-06-16T01:10:03.990Z",
      }),
    );
    mockedIsProcessAlive.mockReturnValue(true);
    mockedExecFileSync.mockReturnValue("node dist/cli.js daemon --project-dir /repo" as never);

    await expect(acquireInstanceLock(tmpDir, stateDir, () => {})).rejects.toThrow(
      /stranded daemon process is already running/,
    );
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
