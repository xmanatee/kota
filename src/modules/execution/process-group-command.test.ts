import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runProcessGroupCommandSync } from "./process-group-command.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("process-group command", () => {
  it("passes arguments directly without shell interpretation", () => {
    const result = runProcessGroupCommandSync({
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.argv[1])", "$(not-a-shell)"],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 1_000,
      outputLimit: 1_000,
    });

    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
    expect(result.stdout).toBe("$(not-a-shell)");
  });

  it("kills descendants when the command exceeds its timeout", async () => {
    const dir = mkdtempSync(join(tmpdir(), "process-group-command-"));
    tempDirs.push(dir);
    const marker = join(dir, "descendant-finished");
    const descendant = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "late"), 250)`;
    const parent = [
      'const { spawn } = require("node:child_process")',
      `spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { stdio: "ignore" })`,
      "setInterval(() => {}, 1_000)",
    ].join(";");

    const result = runProcessGroupCommandSync({
      command: process.execPath,
      args: ["-e", parent],
      cwd: dir,
      env: process.env,
      timeoutMs: 50,
      outputLimit: 1_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(result).toMatchObject({ exitCode: 124, timedOut: true });
    expect(result.stderr).toMatch(/timed out after 50 ms/i);
    expect(existsSync(marker)).toBe(false);
  });
});
