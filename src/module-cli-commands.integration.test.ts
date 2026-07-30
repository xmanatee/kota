import { execFileSync, type SpawnSyncReturns } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = resolve(root, "src/cli.ts");
const CLI_TIMEOUT = 60_000;
const SINGLE_CLI_TEST_TIMEOUT = CLI_TIMEOUT + 15_000;
const DOUBLE_CLI_TEST_TIMEOUT = CLI_TIMEOUT * 2 + 15_000;

function runCli(...args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(process.execPath, ["--import", "tsx", CLI, ...args], {
      encoding: "utf-8",
      timeout: CLI_TIMEOUT,
      cwd: root,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err) {
    const e = err as SpawnSyncReturns<string>;
    return {
      stdout: e.stdout || "",
      stderr: e.stderr || "",
      exitCode: e.status ?? 1,
    };
  }
}

describe("CLI module commands (compiled binary)", () => {
  it("--help lists all module-provided commands", () => {
    const { stdout, stderr, exitCode } = runCli("--help");
    expect(exitCode, stderr || "CLI help exited unsuccessfully").toBe(0);
    expect(stdout).toContain("serve");
    expect(stdout).toContain("daemon");
    expect(stdout).toContain("tools");
    expect(stdout).toContain("run");
    expect(stdout).toContain("history");
  }, SINGLE_CLI_TEST_TIMEOUT);

  it("module commands have working --help", () => {
    const { stdout, exitCode } = runCli("serve", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--model");
    expect(stdout).toContain("--verbose");

    const { stdout: daemonHelp, exitCode: daemonExit } = runCli("daemon", "--help");
    expect(daemonExit).toBe(0);
    expect(daemonHelp).toContain("--verbose");
  }, DOUBLE_CLI_TEST_TIMEOUT);

  it("tools subcommand from registry module works", () => {
    const { stdout, exitCode } = runCli("tools", "list");
    expect(exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  }, SINGLE_CLI_TEST_TIMEOUT);
});
