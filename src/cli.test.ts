import { execFileSync, type SpawnSyncReturns } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatAuthError } from "./cli.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = resolve(root, "dist/cli.js");

function run(...args: string[]): string {
  return execFileSync("node", [CLI, ...args], {
    encoding: "utf-8",
    timeout: 5000,
    cwd: root,
  });
}

/** Run CLI expecting it to fail, return stderr. */
function runExpectFail(...args: string[]): { stderr: string; exitCode: number } {
  try {
    execFileSync("node", [CLI, ...args], {
      encoding: "utf-8",
      timeout: 5000,
      cwd: root,
      env: { ...process.env, ANTHROPIC_API_KEY: "" },
    });
    return { stderr: "", exitCode: 0 };
  } catch (err) {
    const e = err as SpawnSyncReturns<string>;
    return { stderr: e.stderr || "", exitCode: e.status ?? 1 };
  }
}

describe("cli", () => {
  it("--help shows KOTA description", () => {
    const out = run("--help");
    expect(out).toContain("KOTA");
    expect(out).toContain("Keep Only The Awesome");
  });

  it("--version prints semver", () => {
    const out = run("--version");
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("run --help lists all run-specific options", () => {
    const out = run("run", "--help");
    expect(out).toContain("--model");
    expect(out).toContain("--interactive");
    expect(out).toContain("--architect");
    expect(out).toContain("--think");
    expect(out).toContain("--think-budget");
    expect(out).toContain("--session");
    expect(out).toContain("--yes");
    expect(out).toContain("--editor-model");
    expect(out).toContain("--max-tokens");
    expect(out).toContain("--verbose");
  });

  it("default model is claude-sonnet-4-6", () => {
    const out = run("run", "--help");
    expect(out).toContain("claude-sonnet-4-6");
  });
});

describe("API key validation", () => {
  it("exits with clear message when ANTHROPIC_API_KEY is unset", () => {
    const { stderr, exitCode } = runExpectFail("run", "hello");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("ANTHROPIC_API_KEY");
    expect(stderr).toContain("console.anthropic.com");
    expect(stderr).toContain("export ANTHROPIC_API_KEY");
  });

  it("shows actionable instructions for serve without key", () => {
    const { stderr, exitCode } = runExpectFail("serve");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("ANTHROPIC_API_KEY");
  });

  it("does not require API key for help commands", () => {
    // --help should work without API key
    const out = run("--help");
    expect(out).toContain("KOTA");
  });

  it("does not require API key for tools list", () => {
    // tools list should work without API key
    const out = run("tools", "list");
    expect(out).toBeDefined();
  });
});

describe("formatAuthError", () => {
  it("detects 'Could not resolve authentication' error", () => {
    const err = new Error("Could not resolve authentication method. Expected either apiKey or authToken to be set.");
    const msg = formatAuthError(err);
    expect(msg).not.toBeNull();
    expect(msg).toContain("ANTHROPIC_API_KEY");
    expect(msg).toContain("console.anthropic.com");
  });

  it("detects apiKey-related error", () => {
    const err = new Error("Invalid apiKey provided");
    const msg = formatAuthError(err);
    expect(msg).not.toBeNull();
    expect(msg).toContain("authentication failed");
  });

  it("detects 401 status error", () => {
    const err = Object.assign(new Error("Unauthorized"), { status: 401 });
    const msg = formatAuthError(err);
    expect(msg).not.toBeNull();
  });

  it("returns null for non-auth errors", () => {
    expect(formatAuthError(new Error("Network timeout"))).toBeNull();
    expect(formatAuthError(new Error("Rate limited"))).toBeNull();
    expect(formatAuthError(new Error("Internal server error"))).toBeNull();
  });
});
