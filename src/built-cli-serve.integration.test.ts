/**
 * Built CLI serve smoke: prove the shipped command path
 * `node dist/cli.js serve` produces a web server whose provider-backed
 * routes work, not just `/api/health`.
 *
 * Regression context (2026-05-02): the CLI loads modules in `"commands"`
 * mode for cheap subcommand registration, which intentionally skips every
 * module's `onLoad`. The previous `serve` boot path read its routes from
 * the CLI's commands-mode loader through `ctx.getRoutes()`. The
 * lifecycle accessor on `ModuleLoader` now throws for any commands-mode
 * route consumer, so `pnpm build && node dist/cli.js serve` aborted at
 * boot with `requires lifecycle mode "runtime"`. The fix routes serve's
 * local handler through `loadRuntimeModules` (mirroring `daemon` and
 * `mcp-server`); this smoke is the end-to-end proof that the shipped
 * binary boots through that runtime load and that
 * `/api/knowledge` returns 200 because `KnowledgeStore.onLoad` ran.
 *
 * Failure-mode contract:
 *   - `daemon-runtime-load.integration.test.ts` already encodes the
 *     loader-level guard (commands-mode routes throw). If `serve`
 *     regresses back to `ctx.getRoutes()` from a commands-mode loader,
 *     the local handler throws inside the spawned process and this
 *     smoke loses the 200 it asserts below — surfacing the failure
 *     before operators do.
 *
 * Why the spawn shape mirrors the daemon smoke:
 *   - `node dist/cli.js serve` runs in the operator's process directly
 *     (no supervisor fork). Pin `--port` to a pre-reserved free port so
 *     the test does not race the OS for an arbitrary port; capture the
 *     auth token from stdout where `startServer` prints it. `HOME` is
 *     redirected so the test never reads the developer's
 *     `~/.kota/config.json`. `NODE_OPTIONS` is cleared because the
 *     vitest parent runs with `--conditions=source` (TypeScript
 *     resolution), and `dist/cli.js` must run with the production
 *     resolution (`.js` files in `dist/`).
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
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
        `mode it pins down (commands-mode-sourced serve) only surfaces through ` +
        `the full bootstrap, not through unit-level stubs.`,
    );
  }
});

async function reserveFreePort(): Promise<number> {
  return new Promise((resolveOk, rejectErr) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", rejectErr);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close(() => rejectErr(new Error("probe socket has no address")));
        return;
      }
      const { port } = address;
      probe.close(() => resolveOk(port));
    });
  });
}

async function pollForToken(
  child: ChildProcess,
  buffers: { stdout: Buffer[]; stderr: Buffer[] },
  timeoutMs: number,
  earlyExit: Promise<number>,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const exitSentinel = Symbol("exit");
  const exitWatcher = earlyExit.then((code) => ({ exitSentinel, code }));

  while (Date.now() < deadline) {
    const stdout = Buffer.concat(buffers.stdout).toString();
    const tokenMatch = stdout.match(/^Auth token: (\S+)\s*$/m);
    if (tokenMatch) return tokenMatch[1]!;
    const tick = new Promise<"tick">((r) => setTimeout(() => r("tick"), 100));
    const result = await Promise.race([tick, exitWatcher]);
    if (typeof result === "object" && result !== null && "exitSentinel" in result) {
      const stderrText = Buffer.concat(buffers.stderr).toString();
      throw new Error(
        `serve exited (code=${(result as { code: number }).code}) before printing auth token.\n` +
          `--- stdout ---\n${stdout}\n--- stderr ---\n${stderrText}`,
      );
    }
  }
  const stdoutText = Buffer.concat(buffers.stdout).toString();
  const stderrText = Buffer.concat(buffers.stderr).toString();
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for "Auth token: ..." in stdout.\n` +
      `--- stdout ---\n${stdoutText}\n--- stderr ---\n${stderrText}`,
  );
}

async function fetchAuthorized(
  port: number,
  path: string,
  token: string,
): Promise<Response> {
  return globalThis.fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

type ExitOutcome = { kind: "exit"; code: number | null; signal: NodeJS.Signals | null } | { kind: "timeout" };

async function waitForExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<ExitOutcome> {
  if (child.exitCode !== null) {
    return { kind: "exit", code: child.exitCode, signal: child.signalCode };
  }
  return new Promise<ExitOutcome>((resolveExit) => {
    const timer = setTimeout(() => resolveExit({ kind: "timeout" }), timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolveExit({ kind: "exit", code, signal });
    });
  });
}

describe("built CLI serve smoke (provider-backed routes)", () => {
  let projectDir: string;
  let stateDir: string;
  let homeDir: string;
  let child: ChildProcess | null;
  let stderrChunks: Buffer[];
  let stdoutChunks: Buffer[];

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-built-cli-serve-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    stateDir = join(projectDir, ".kota");
    homeDir = join(projectDir, "home");
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(homeDir, { recursive: true });
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
      const outcome = await waitForExit(child, 8_000);
      if (outcome.kind === "timeout") {
        child.kill("SIGKILL");
        await waitForExit(child, 2_000);
      }
    }
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("`node dist/cli.js serve` serves /api/knowledge with 200 (provider onLoad ran)", async () => {
    const port = await reserveFreePort();

    child = spawn(
      process.execPath,
      [
        CLI_PATH,
        "serve",
        "--port",
        String(port),
      ],
      {
        // `kota serve` reads its project root from process.cwd(); pinning the
        // child's cwd to a temp dir is therefore the project pin.
        cwd: projectDir,
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

    const token = await pollForToken(
      child,
      { stdout: stdoutChunks, stderr: stderrChunks },
      30_000,
      exited,
    );

    const res = await fetchAuthorized(port, "/api/knowledge?scope=project", token);
    const bodyText = await res.text();
    expect(
      res.status,
      `expected 200 from /api/knowledge; got ${res.status}; body=${bodyText}`,
    ).toBe(200);
    const body = JSON.parse(bodyText) as { entries: unknown[] };
    expect(Array.isArray(body.entries)).toBe(true);

    child.kill("SIGTERM");
    const outcome = await waitForExit(child, 10_000);
    // `kota serve` has no graceful-shutdown handler today: SIGTERM kills the
    // Node process directly, so the OS-level exit reports `signal=SIGTERM`
    // with `code=null`. A clean exit-code path (graceful close, port
    // unbound, no leftover work) would land as `code=0`. Either is
    // acceptable here; the failure mode this smoke pins down is the boot
    // failure ahead of token publication, not shutdown ergonomics.
    expect(
      outcome.kind === "exit" && (outcome.code === 0 || outcome.signal === "SIGTERM"),
      `serve did not exit within 10s after SIGTERM; outcome=${JSON.stringify(outcome)}; ` +
        `stderr:\n${Buffer.concat(stderrChunks).toString()}`,
    ).toBe(true);
  }, 60_000);
});
