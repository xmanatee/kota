import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCheck } from "./shared.js";

const dirs: string[] = [];
const STAY_ALIVE_CHILD_SCRIPT =
  "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)";

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

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (existsSync(path)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runCheck", () => {
  it("kills shell-launched descendants when a command times out", async () => {
    if (process.platform === "win32") return;
    const dir = tempDir("timeout-tree");
    const pidFile = join(dir, "child.pid");

    await expect(
      runCheck(
        `${shellQuote(process.execPath)} -e ${shellQuote(STAY_ALIVE_CHILD_SCRIPT)} ${shellQuote(pidFile)}`,
        dir,
        { timeoutMs: 2_000 },
      ),
    ).rejects.toThrow(/Command timed out/);

    expect(existsSync(pidFile)).toBe(true);
    expect(processExists(Number(readFileSync(pidFile, "utf8")))).toBe(false);
  });

  it("kills shell-launched descendants when the workflow aborts", async () => {
    if (process.platform === "win32") return;
    const dir = tempDir("abort-tree");
    const pidFile = join(dir, "child.pid");
    const controller = new AbortController();
    const check = runCheck(
      `${shellQuote(process.execPath)} -e ${shellQuote(STAY_ALIVE_CHILD_SCRIPT)} ${shellQuote(pidFile)}`,
      dir,
      { timeoutMs: 10_000, signal: controller.signal },
    );

    await waitForFile(pidFile);
    const reason = new Error("workflow aborted");
    controller.abort(reason);

    await expect(check).rejects.toBe(reason);
    expect(processExists(Number(readFileSync(pidFile, "utf8")))).toBe(false);
  });
});
