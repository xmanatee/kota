import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  pollControlFile,
  waitForExit,
} from "#core/daemon/built-cli-daemon-test-support.integration.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const CLI_PATH = join(REPO_ROOT, "dist", "cli.js");
const CLI_TIMEOUT = 45_000;

beforeAll(() => {
  if (!existsSync(CLI_PATH)) {
    throw new Error(`dist/cli.js missing at ${CLI_PATH}. Run \`pnpm build\` before this test.`);
  }
});

describe("built CLI external scope onboarding journey", () => {
  let root: string;
  let hostRoot: string;
  let targetRoot: string;
  let homeDir: string;
  let ttyPreload: string;
  let child: ChildProcess | null;
  let daemonStderr: Buffer[];

  beforeEach(() => {
    root = join(
      tmpdir(),
      `kota-scope-cli-journey-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    hostRoot = join(root, "host");
    targetRoot = join(root, "external");
    homeDir = join(root, "home");
    ttyPreload = join(root, "interactive-stdin.mjs");
    mkdirSync(join(hostRoot, ".kota"), { recursive: true });
    mkdirSync(targetRoot, { recursive: true });
    mkdirSync(join(homeDir, ".kota"), { recursive: true });
    writeFileSync(
      join(homeDir, ".kota", "config.json"),
      JSON.stringify({ trustedScopes: [hostRoot] }),
    );
    writeFileSync(
      join(hostRoot, ".kota", "config.json"),
      JSON.stringify({ defaultAgentHarness: "codex" }),
    );
    writeFileSync(
      ttyPreload,
      'Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });\n',
    );
    child = null;
    daemonStderr = [];
  });

  afterEach(async () => {
    if (child && !child.killed && child.exitCode === null) {
      child.kill("SIGTERM");
      if (await waitForExit(child, 8_000) === null) {
        child.kill("SIGKILL");
        await waitForExit(child, 2_000);
      }
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("onboards idempotently and re-registers a removed scope without data loss", async () => {
    const env = isolatedEnv();
    child = spawn(
      process.execPath,
      [CLI_PATH, "daemon", "--scope-root", hostRoot, "--log-format", "json"],
      { env },
    );
    child.stderr?.on("data", (data) => daemonStderr.push(Buffer.from(data)));
    const exited = new Promise<number>((resolveExit) => {
      child!.once("exit", (code) => resolveExit(code ?? -1));
    });
    try {
      await pollControlFile(join(hostRoot, ".kota"), 25_000, exited);
    } catch (error) {
      throw new Error(
        `${(error as Error).message}\n--- daemon stderr ---\n${Buffer.concat(daemonStderr).toString()}`,
      );
    }

    const first = runInteractiveCli(["scope", "add", targetRoot], env, "y\n");
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("Existing: .kota=false; config=false; task-queue=false");
    expect(first.stdout).toContain("Plan plan_");
    expect(first.stdout).toContain("Operation onboard_");
    expect(first.stdout).toContain("state=succeeded; attempts=1");
    expect(first.stdout).toContain("Readiness: registered=true; configured=true");
    expect(existsSync(join(targetRoot, ".kota", "owner-decisions"))).toBe(true);
    expect(existsSync(join(targetRoot, ".kota", "config.json"))).toBe(false);

    mkdirSync(join(targetRoot, "data", "tasks"), { recursive: true });
    mkdirSync(join(targetRoot, "data", "inbox"), { recursive: true });
    writeFileSync(join(targetRoot, "AGENTS.md"), "# External scope guidance\n");
    writeFileSync(join(targetRoot, "data", "inbox", "keep.md"), "operator-owned\n");

    const second = runInteractiveCli(["scope", "add", targetRoot], env);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain(
      "Existing: .kota=true; config=false; task-queue=true; inbox=true; guidance=AGENTS.md",
    );
    expect(second.stdout).toContain("state=succeeded; attempts=1");
    expect(second.stdout).not.toContain("Plan plan_");
    expect(readFileSync(join(targetRoot, "AGENTS.md"), "utf8"))
      .toBe("# External scope guidance\n");
    expect(readFileSync(join(targetRoot, "data", "inbox", "keep.md"), "utf8"))
      .toBe("operator-owned\n");

    const jsonResult = runInteractiveCli(["scope", "add", targetRoot, "--json"], env);
    expect(jsonResult.status, jsonResult.stderr).toBe(0);
    expect(JSON.parse(jsonResult.stdout)).toMatchObject({
      ok: true,
      inspection: {
        scopeId: deriveDirectoryScopeId(targetRoot),
        registered: true,
        hostingState: "hosted",
        existing: {
          kotaState: true,
          scopeConfig: false,
          taskQueue: true,
          inbox: true,
          guidance: ["AGENTS.md"],
        },
      },
      operation: {
        state: "succeeded",
        attempts: 1,
        readiness: { registered: true, configured: true },
      },
    });

    const listed = runInteractiveCli(["scope", "list", "--json"], env);
    expect(listed.status, listed.stderr).toBe(0);
    expect(JSON.parse(listed.stdout).scopes).toContainEqual(expect.objectContaining({
      scopeId: deriveDirectoryScopeId(targetRoot),
      scopeRoot: targetRoot,
    }));

    const scopeId = deriveDirectoryScopeId(targetRoot);
    const drained = runInteractiveCli(["scope", "drain", scopeId], env, "y\n");
    expect(drained.status, drained.stderr).toBe(0);
    const removed = runInteractiveCli(["scope", "remove", scopeId], env, "y\n");
    expect(removed.status, removed.stderr).toBe(0);

    const readded = runInteractiveCli(["scope", "add", targetRoot], env, "y\n");
    expect(readded.status, readded.stderr).toBe(0);
    expect(readded.stdout).toContain("registered=false");
    expect(readded.stdout).toContain("state=succeeded; attempts=2");
    expect(readFileSync(join(targetRoot, "AGENTS.md"), "utf8"))
      .toBe("# External scope guidance\n");
    expect(readFileSync(join(targetRoot, "data", "inbox", "keep.md"), "utf8"))
      .toBe("operator-owned\n");
    const relisted = runInteractiveCli(["scope", "list", "--json"], env);
    expect(relisted.status, relisted.stderr).toBe(0);
    expect(JSON.parse(relisted.stdout).scopes).toContainEqual(expect.objectContaining({
      scopeId,
      scopeRoot: targetRoot,
    }));
  }, 80_000);

  function isolatedEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: homeDir,
      KOTA_SCOPE_ROOT: hostRoot,
      KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH: join(
        homeDir,
        ".kota",
        "scope-authority-operator-token.json",
      ),
      NODE_OPTIONS: "",
    };
    delete env.KOTA_SESSION_ID;
    return env;
  }

  function runInteractiveCli(
    args: string[],
    env: NodeJS.ProcessEnv,
    input = "",
  ): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync(
      process.execPath,
      ["--import", ttyPreload, CLI_PATH, ...args],
      {
        cwd: hostRoot,
        encoding: "utf8",
        env,
        input,
        timeout: CLI_TIMEOUT,
      },
    );
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
});
