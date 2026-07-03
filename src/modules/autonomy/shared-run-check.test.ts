import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCheck } from "./shared.js";

const dirs: string[] = [];

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `kota-run-check-${label}-`));
  dirs.push(dir);
  return dir;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    throw error;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runCheck", () => {
  it("kills shell-launched descendants when a command times out", () => {
    if (process.platform === "win32") return;
    const dir = tempDir("timeout-tree");
    const pidFile = join(dir, "child.pid");
    const childScript = "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)";

    expect(() =>
      runCheck(
        `${shellQuote(process.execPath)} -e ${shellQuote(childScript)} ${shellQuote(pidFile)}`,
        dir,
        250,
      ),
    ).toThrow(/Command timed out/);

    expect(existsSync(pidFile)).toBe(true);
    expect(processExists(Number(readFileSync(pidFile, "utf8")))).toBe(false);
  });
});
