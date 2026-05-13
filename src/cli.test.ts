import { execFileSync, type SpawnSyncReturns } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { formatAuthError, parseIntOption } from "./cli.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = resolve(root, "src/cli.ts");
const require = createRequire(import.meta.url);
const TSX_IMPORT = require.resolve("tsx");

const CLI_TIMEOUT = 15_000;

function run(...args: string[]): string {
  return execFileSync(process.execPath, ["--import", TSX_IMPORT, CLI, ...args], {
    encoding: "utf-8",
    timeout: CLI_TIMEOUT,
    cwd: root,
  });
}

/** Run CLI expecting it to fail, return stderr. */
function runExpectFail(...args: string[]): { stderr: string; exitCode: number } {
  try {
    execFileSync(process.execPath, ["--import", TSX_IMPORT, CLI, ...args], {
      encoding: "utf-8",
      timeout: CLI_TIMEOUT,
      cwd: root,
      env: { ...process.env, KOTA_PRESET: "claude", ANTHROPIC_API_KEY: "" },
    });
    return { stderr: "", exitCode: 0 };
  } catch (err) {
    const e = err as SpawnSyncReturns<string>;
    return { stderr: e.stderr || "", exitCode: e.status ?? 1 };
  }
}

/** Run CLI with full control: custom env, stdin, cwd. */
function runFull(
  args: string[],
  opts?: { env?: Record<string, string>; input?: string; cwd?: string },
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(process.execPath, ["--import", TSX_IMPORT, CLI, ...args], {
      encoding: "utf-8",
      timeout: CLI_TIMEOUT,
      cwd: opts?.cwd ?? root,
      env: { ...process.env, ...opts?.env },
      input: opts?.input,
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

function mkdtempForCli(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
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
    expect(out).toContain("--harness");
  });

  it("default model is the active preset's defaultModel", () => {
    const out = run("run", "--help");
    expect(out).toContain("active preset");
    expect(out).toMatch(/--preset/);
  });
});

describe("API key validation", () => {
  it("exits with clear message when ANTHROPIC_API_KEY is unset (claude preset preflight)", () => {
    const { stderr, exitCode } = runExpectFail("run", "hello");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("ANTHROPIC_API_KEY");
    expect(stderr).toMatch(/preset "claude"/);
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

describe("parseIntOption", () => {
  it("parses valid positive integers", () => {
    expect(parseIntOption("42", "test")).toBe(42);
    expect(parseIntOption("1", "test")).toBe(1);
    expect(parseIntOption("8192", "test")).toBe(8192);
  });

  it("rejects non-numeric strings", () => {
    const { stderr, exitCode } = runFull(["run", "--max-tokens", "abc", "hello"], {
      env: { ANTHROPIC_API_KEY: "" },
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--max-tokens");
    expect(stderr).toContain("positive integer");
    expect(stderr).toContain("abc");
  });

  it("rejects zero", () => {
    const { stderr, exitCode } = runFull(["run", "--max-tokens", "0", "hello"], {
      env: { ANTHROPIC_API_KEY: "" },
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--max-tokens");
  });

  it("rejects negative numbers", () => {
    const { stderr, exitCode } = runFull(["run", "--max-tokens", "-5", "hello"], {
      env: { ANTHROPIC_API_KEY: "" },
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--max-tokens");
  });

  it("rejects floating point for serve port", () => {
    const { stderr, exitCode } = runFull(["serve", "--port", "not-a-port"], {
      env: { ANTHROPIC_API_KEY: "" },
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--port");
    expect(stderr).toContain("positive integer");
  });

  it("rejects invalid think-budget", () => {
    const { stderr, exitCode } = runFull(
      ["run", "--think", "--think-budget", "xyz", "hello"],
      { env: { ANTHROPIC_API_KEY: "" } },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--think-budget");
  });

  it("rejects invalid history limit", () => {
    const { stderr, exitCode } = runFull(["history", "list", "--limit", "foo"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--limit");
    expect(stderr).toContain("positive integer");
  });
});

describe("preset resolution", () => {
  // The active preset (`--preset` flag, `KOTA_PRESET` env, `config.defaultPreset`,
  // shipped default) decides harness + default model + tier mapping. An unknown
  // preset must fail loudly rather than silently falling back to claude.
  it("rejects an unknown --preset id", () => {
    const { stderr, exitCode } = runFull(
      ["run", "--preset", "nope", "hello"],
      { env: { ANTHROPIC_API_KEY: "sk-ant-test", HOME: "/tmp/kota-test-no-config" } },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Unknown preset "nope"/);
  });

  it("rejects an unknown KOTA_PRESET env value", () => {
    const { stderr, exitCode } = runFull(["run", "hello"], {
      env: {
        ANTHROPIC_API_KEY: "sk-ant-test",
        HOME: "/tmp/kota-test-no-config",
        KOTA_PRESET: "wat",
      },
    });
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Unknown preset "wat"/);
  });
});

describe("--continue validation", () => {
  it("exits with error when no previous conversation exists", () => {
    const { exitCode } = runFull(["run", "--continue", "hello"], {
      env: { ANTHROPIC_API_KEY: "sk-ant-test", HOME: "/tmp/kota-test-nonexistent" },
    });
    expect(exitCode).toBe(1);
  });
});

describe("subcommand help", () => {
  it("serve --help lists port and model options", () => {
    const out = run("serve", "--help");
    expect(out).toContain("--port");
    expect(out).toContain("--model");
    expect(out).toContain("--verbose");
  });

  it("tools --help lists install, list, remove, update", () => {
    const out = run("tools", "--help");
    expect(out).toContain("install");
    expect(out).toContain("list");
    expect(out).toContain("remove");
    expect(out).toContain("update");
  });

  it("history --help lists list, show, resume, delete, clear", () => {
    const out = run("history", "--help");
    expect(out).toContain("list");
    expect(out).toContain("show");
    expect(out).toContain("resume");
    expect(out).toContain("delete");
    expect(out).toContain("clear");
  });
});

describe("history clear confirmation", () => {
  let tempHome: string;

  // Pin `KOTA_PROJECT_DIR` and `cwd` to `tempHome` so the contract selector
  // finds no `<projectDir>/.kota/daemon-control.json` and resolves a fresh
  // project-scoped `LocalKotaClient` against the seeded temp history. Without
  // this guard the CLI would route through any daemon currently serving the
  // developer's machine and wipe the wrong dataset.
  beforeEach(() => {
    tempHome = realpathSync(mkdtempForCli("kota-test-clear"));
    const histDir = join(tempHome, ".kota", "history");
    mkdirSync(histDir, { recursive: true });
    const index = {
      conversations: [
        {
          id: "test-abc123",
          title: "test conversation",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          model: "claude-sonnet-4-6",
          messageCount: 2,
          cwd: tempHome,
        },
      ],
    };
    writeFileSync(join(histDir, "index.json"), JSON.stringify(index));
    writeFileSync(
      join(histDir, "test-abc123.json"),
      JSON.stringify({ record: index.conversations[0], messages: [], compactionCount: 0, lastInputTokens: 0 }),
    );
  });

  it("cancels when stdin is not a TTY (no --yes)", () => {
    const { stdout, exitCode } = runFull(["history", "clear"], {
      env: { HOME: tempHome, KOTA_PROJECT_DIR: tempHome },
      cwd: tempHome,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Cancelled");
    // Verify conversation was NOT deleted
    expect(existsSync(join(tempHome, ".kota", "history", "test-abc123.json"))).toBe(true);
  });

  it("deletes when --yes flag is provided", () => {
    const { stdout, exitCode } = runFull(["history", "clear", "--yes"], {
      env: { HOME: tempHome, KOTA_PROJECT_DIR: tempHome },
      cwd: tempHome,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Deleted 1 conversation(s)");
  });

  it("reports no conversations when history is empty", () => {
    // Use a fresh home with no history
    const emptyHome = realpathSync(mkdtempForCli("kota-test-empty"));
    const { stdout, exitCode } = runFull(["history", "clear"], {
      env: { HOME: emptyHome, KOTA_PROJECT_DIR: emptyHome },
      cwd: emptyHome,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("No conversations to delete");
  });
});

describe("history resume validation", () => {
  it("exits with error for non-existent conversation ID", () => {
    // Pin `KOTA_PROJECT_DIR` to a fresh temp dir so the contract selector
    // finds no `<projectDir>/.kota/daemon-control.json` and resolves a
    // project-scoped `LocalKotaClient` against the empty temp history.
    // Without this guard the CLI would route through any daemon currently
    // serving the developer's machine and either find an unrelated
    // conversation or surface a `fetch` abort instead of the expected
    // "not found" error.
    const tempHome = realpathSync(mkdtempForCli("kota-test-resume"));
    const { stderr, exitCode } = runFull(["history", "resume", "someId"], {
      env: { ANTHROPIC_API_KEY: "", HOME: tempHome, KOTA_PROJECT_DIR: tempHome },
      cwd: tempHome,
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });
});
