/**
 * Built CLI daemon smoke: prove the shipped command path
 * `node dist/cli.js daemon` produces a daemon whose provider-backed
 * routes work, not just `/status`.
 *
 * The 2026-04-28 regression that drove this gate: the CLI loads modules
 * in `"commands"` mode for cheap subcommand registration, which
 * intentionally skips every module's `onLoad`. The daemon command was
 * reading routes, controlRoutes, workflows, channels, agents, skills,
 * health checks, and config keys from that same partial context. The
 * shipped binary advertised `/api/knowledge`, `/api/memory`,
 * `/api/history`, `/recall`, `/answer` — all returning 500 with
 * "provider not initialized" — while `/status` looked healthy. Existing
 * coverage instantiated `new Daemon(...)` directly, so the broken
 * arm only surfaced through manual `pnpm build && node dist/cli.js
 * daemon`. The lifecycle accessor on `ModuleLoader` now throws if a
 * `"commands"` loader is asked for runtime contributions, but this smoke
 * remains the end-to-end proof that the shipped binary boots through
 * `loadRuntimeModules`.
 *
 * This test closes that gap by spawning the actual built CLI daemon
 * command against a temp project, reading the published bearer token
 * out of `<projectDir>/.kota/daemon-control.json`, and asserting
 * `/api/knowledge` returns 200 with the typed `entries` shape — only
 * possible if the daemon process drove `loadRuntimeModules` and
 * `KnowledgeStore` registered itself through `onLoad`.
 *
 * Failure-mode contract:
 *   - The in-process two-arm fixture lives in
 *     `daemon-runtime-load.integration.test.ts`. It encodes the inverse
 *     direction explicitly: a `"commands"` loader's typed accessors throw
 *     before a daemon can ever ingest its routes. If the daemon command
 *     in `src/modules/daemon-ops/index.ts` ever regresses back to
 *     reading contributions from the CLI's `"commands"` loader, the
 *     loader-level guard fails loudly inside the daemon process and this
 *     smoke loses the 200 it asserts below.
 *
 * Why the spawn shape:
 *   - `node dist/cli.js daemon` is the supervisor mode: the parent
 *     process forks a child with `KOTA_DAEMON_CHILD=1` set. SIGTERM to
 *     the supervisor is forwarded to the child, which triggers the
 *     daemon's clean-shutdown path. `--project-dir` pins the project
 *     root; `HOME` redirect isolates the test from the developer's
 *     `~/.kota/config.json`. `NODE_OPTIONS` is cleared because the
 *     vitest parent runs with `--conditions=source` (TypeScript
 *     resolution), and `dist/cli.js` must run with the production
 *     resolution (`.js` files in `dist/`).
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const CLI_PATH = join(REPO_ROOT, "dist", "cli.js");

beforeAll(() => {
  if (!existsSync(CLI_PATH)) {
    throw new Error(
      `dist/cli.js missing at ${CLI_PATH}. Run \`pnpm build\` before \`pnpm test\`. ` +
        `This smoke is intentionally tied to the shipped CLI binary: the failure ` +
        `mode it pins down (commands-mode-sourced daemon) only surfaces through ` +
        `the full bootstrap, not through \`new Daemon(...)\`.`,
    );
  }
});

type ControlAddress = { port: number; token: string; startedAt: string };
type LoopbackAwareGlobal = typeof globalThis & {
  __kotaRealLoopbackAvailable?: boolean;
};

function realLoopbackAvailable(): boolean {
  return (globalThis as LoopbackAwareGlobal).__kotaRealLoopbackAvailable !== false;
}

async function pollControlFile(
  stateDir: string,
  timeoutMs: number,
  earlyExit: Promise<number>,
): Promise<ControlAddress> {
  const controlPath = join(stateDir, "daemon-control.json");
  const deadline = Date.now() + timeoutMs;
  const exitSentinel = Symbol("exit");
  const exitWatcher = earlyExit.then((code) => ({ exitSentinel, code }));

  while (Date.now() < deadline) {
    if (existsSync(controlPath)) {
      const raw = readFileSync(controlPath, "utf-8");
      const parsed = JSON.parse(raw) as { port?: number; token?: string; startedAt?: string };
      if (parsed.port && parsed.token && parsed.startedAt) {
        return { port: parsed.port, token: parsed.token, startedAt: parsed.startedAt };
      }
    }
    const tick = new Promise<"tick">((r) => setTimeout(() => r("tick"), 100));
    const result = await Promise.race([tick, exitWatcher]);
    if (typeof result === "object" && result !== null && "exitSentinel" in result) {
      throw new Error(
        `daemon exited (code=${(result as { code: number }).code}) before publishing daemon-control.json`,
      );
    }
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${controlPath} to appear.`,
  );
}

async function pollControlFileReplacement(
  stateDir: string,
  previous: ControlAddress,
  timeoutMs: number,
  earlyExit: Promise<number>,
): Promise<ControlAddress> {
  const deadline = Date.now() + timeoutMs;
  const exitSentinel = Symbol("exit");
  const exitWatcher = earlyExit.then((code) => ({ exitSentinel, code }));

  while (Date.now() < deadline) {
    const tick = new Promise<"tick">((r) => setTimeout(() => r("tick"), 100));
    const result = await Promise.race([tick, exitWatcher]);
    if (typeof result === "object" && result !== null && "exitSentinel" in result) {
      throw new Error(
        `daemon supervisor exited (code=${(result as { code: number }).code}) while restart was expected`,
      );
    }

    const controlPath = join(stateDir, "daemon-control.json");
    if (!existsSync(controlPath)) continue;
    let current: ControlAddress | null = null;
    try {
      const parsed = JSON.parse(readFileSync(controlPath, "utf-8")) as {
        port?: number;
        token?: string;
        startedAt?: string;
      };
      if (parsed.port && parsed.token && parsed.startedAt) {
        current = {
          port: parsed.port,
          token: parsed.token,
          startedAt: parsed.startedAt,
        };
      }
    } catch {
      continue;
    }
    if (current === null) continue;
    if (
      current.port !== previous.port ||
      current.token !== previous.token ||
      current.startedAt !== previous.startedAt
    ) {
      return current;
    }
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for daemon-control.json to be replaced after restart.`,
  );
}

async function fetchAuthorized(
  port: number,
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  return globalThis.fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
}

function writeRestartRegressionModule(stateDir: string): void {
  const moduleDir = join(stateDir, "modules", "restart-regression");
  mkdirSync(moduleDir, { recursive: true });
  writeFileSync(
    join(moduleDir, "index.mjs"),
    `export default {
  name: "restart-regression",
  version: "1.0.0",
  description: "Built CLI supervised restart regression fixture",
  workflows: [
    {
      name: "restart-regression",
      triggers: [{ event: "manual" }],
      steps: [
        { id: "verify", type: "code", run: () => "ok" },
        {
          id: "request-restart",
          type: "restart",
          requires: ["verify"],
          reason: "built CLI supervised restart regression"
        }
      ]
    }
  ]
};
`,
  );
}

async function waitForExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise<number | null>((resolveExit) => {
    const timer = setTimeout(() => resolveExit(null), timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolveExit(code);
    });
  });
}

describe.skipIf(!realLoopbackAvailable())("built CLI daemon smoke (provider-backed routes)", () => {
  let projectDir: string;
  let stateDir: string;
  let homeDir: string;
  let child: ChildProcess | null;
  let stderrChunks: Buffer[];
  let stdoutChunks: Buffer[];

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-built-cli-daemon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    stateDir = join(projectDir, ".kota");
    homeDir = join(projectDir, "home");
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    // Pin a default agent harness so any workflow validation that walks
    // shipped autonomy steps without explicit `harness:` overrides resolves
    // through the same path operators see in production. Provider-backed
    // route assertions are independent of which adapter is configured.
    writeFileSync(
      join(stateDir, "config.json"),
      JSON.stringify({ defaultAgentHarness: "claude-agent-sdk" }),
    );
    child = null;
    stderrChunks = [];
    stdoutChunks = [];
  });

  afterEach(async () => {
    if (child && !child.killed && child.exitCode === null) {
      child.kill("SIGTERM");
      const exitCode = await waitForExit(child, 8_000);
      if (exitCode === null) {
        // Force-kill if the supervisor did not propagate SIGTERM.
        child.kill("SIGKILL");
        await waitForExit(child, 2_000);
      }
    }
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("`node dist/cli.js daemon` serves /api/knowledge with 200 (provider onLoad ran)", async () => {
    child = spawn(
      process.execPath,
      [CLI_PATH, "daemon", "--project-dir", projectDir, "--log-format", "json"],
      {
        env: {
          ...process.env,
          // Redirect homedir() so we never read the developer's
          // ~/.kota/config.json into the smoke under test.
          HOME: homeDir,
          // The vitest parent runs with `--conditions=source` to import
          // TypeScript directly. That env var would propagate and make
          // dist/cli.js's `#core/*.js` imports try to resolve against
          // `.ts` files that plain `node` cannot load.
          NODE_OPTIONS: "",
        },
      },
    );
    child.stdout?.on("data", (d) => stdoutChunks.push(Buffer.from(d)));
    child.stderr?.on("data", (d) => stderrChunks.push(Buffer.from(d)));

    const exited = new Promise<number>((resolveExit) => {
      child!.once("exit", (code) => resolveExit(code ?? -1));
    });

    let address: ControlAddress;
    try {
      address = await pollControlFile(stateDir, 25_000, exited);
    } catch (err) {
      const stderrText = Buffer.concat(stderrChunks).toString();
      const stdoutText = Buffer.concat(stdoutChunks).toString();
      throw new Error(
        `${(err as Error).message}\n--- daemon stderr ---\n${stderrText}\n--- daemon stdout ---\n${stdoutText}`,
      );
    }

    const res = await fetchAuthorized(address.port, "/api/knowledge?scope=project", address.token);
    const bodyText = await res.text();
    expect(
      res.status,
      `expected 200 from /api/knowledge; got ${res.status}; body=${bodyText}`,
    ).toBe(200);
    const body = JSON.parse(bodyText) as { entries: unknown[] };
    expect(Array.isArray(body.entries)).toBe(true);

    // SIGTERM the supervisor; expect a clean exit and the control file
    // removed. The supervisor forwards the signal to the child, the
    // daemon's signal handler stops the runtime, and the daemon's stop
    // path unlinks daemon-control.json before the supervisor returns.
    child.kill("SIGTERM");
    const exitCode = await waitForExit(child, 10_000);
    expect(
      exitCode,
      `daemon supervisor did not exit cleanly within 10s after SIGTERM; ` +
        `stderr:\n${Buffer.concat(stderrChunks).toString()}`,
    ).not.toBeNull();
    expect(exitCode).toBe(0);
    expect(
      existsSync(join(stateDir, "daemon-control.json")),
      "daemon-control.json must be removed on clean shutdown",
    ).toBe(false);
  }, 60_000);

  it("relaunches the supervised child after a runtime restart request", async () => {
    writeRestartRegressionModule(stateDir);
    child = spawn(
      process.execPath,
      [CLI_PATH, "daemon", "--project-dir", projectDir, "--log-format", "json", "--poll-interval", "1"],
      {
        env: {
          ...process.env,
          HOME: homeDir,
          NODE_OPTIONS: "",
        },
      },
    );
    child.stdout?.on("data", (d) => stdoutChunks.push(Buffer.from(d)));
    child.stderr?.on("data", (d) => stderrChunks.push(Buffer.from(d)));

    const exited = new Promise<number>((resolveExit) => {
      child!.once("exit", (code) => resolveExit(code ?? -1));
    });

    const firstAddress = await pollControlFile(stateDir, 25_000, exited);
    const triggerRes = await fetchAuthorized(
      firstAddress.port,
      "/workflow/trigger",
      firstAddress.token,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "restart-regression" }),
      },
    );
    const triggerBody = await triggerRes.text();
    expect(
      triggerRes.status,
      `expected workflow trigger route to accept request; got ${triggerRes.status}; body=${triggerBody}`,
    ).toBe(200);

    const secondAddress = await pollControlFileReplacement(
      stateDir,
      firstAddress,
      25_000,
      exited,
    );
    const statusRes = await fetchAuthorized(secondAddress.port, "/status", secondAddress.token);
    expect(statusRes.status).toBe(200);

    child.kill("SIGTERM");
    const exitCode = await waitForExit(child, 10_000);
    expect(
      exitCode,
      `daemon supervisor did not exit cleanly within 10s after restart regression; ` +
        `stderr:\n${Buffer.concat(stderrChunks).toString()}`,
    ).not.toBeNull();
    expect(exitCode).toBe(0);
  }, 80_000);
});
