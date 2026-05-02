/**
 * Built CLI mcp-server smoke: prove the shipped command path
 * `node dist/cli.js mcp-server` produces a JSON-RPC stdio server that
 * advertises tools — only possible if every tool-contributing module's
 * `onLoad` has run and `registerTool` was invoked.
 *
 * Regression context: long-lived shipped subcommands (`daemon`, `serve`,
 * `mcp-server`) are the audit set that must not silently regress to a
 * commands-mode `ModuleLoader` snapshot. The CLI bootstraps modules in
 * `"commands"` mode for cheap subcommand registration, which skips
 * `onLoad` and `registerTool`. A regression here would let
 * `tools/list` come back empty from the shipped binary while unit tests
 * with mocked module loaders kept passing. This smoke is the end-to-end
 * guard that complements `built-cli-daemon.integration.test.ts` and
 * `built-cli-serve.integration.test.ts`.
 *
 * Wire shape:
 *   - Spawn the shipped binary with stdio pipes.
 *   - Send `initialize` and `tools/list` JSON-RPC requests on stdin.
 *   - Assert the server returns a non-empty tool list. Built-in tools
 *     (read, write, search, ...) are registered through module-owned
 *     `registerTool` calls behind `onLoad`; an empty list reproduces the
 *     commands-mode-loader bug class for the MCP path.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
        `mode it pins down (commands-mode-sourced mcp-server, missing tools) only ` +
        `surfaces through the full bootstrap, not through unit-level mocks.`,
    );
  }
});

type RpcRequest = {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
};

type RpcResponse = {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
};

class JsonRpcStdio {
  private buffer = "";
  private pending = new Map<number | string, {
    resolve: (response: RpcResponse) => void;
    reject: (error: Error) => void;
  }>();
  private closed = false;
  private readonly stdoutListener: (chunk: Buffer) => void;
  private readonly closeListener: () => void;
  private nextId = 1;

  constructor(private readonly child: ChildProcess) {
    this.stdoutListener = (chunk: Buffer) => this.onStdoutChunk(chunk);
    this.closeListener = () => this.closeAllPending(new Error("child stdout closed"));
    child.stdout?.on("data", this.stdoutListener);
    child.stdout?.on("close", this.closeListener);
  }

  request(method: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<RpcResponse> {
    if (this.closed) return Promise.reject(new Error("rpc client closed"));
    const id = this.nextId++;
    const message: RpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise<RpcResponse>((resolveReq, rejectReq) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectReq(new Error(`rpc ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (response) => {
          clearTimeout(timer);
          resolveReq(response);
        },
        reject: (err) => {
          clearTimeout(timer);
          rejectReq(err);
        },
      });
      const ok = this.child.stdin?.write(`${JSON.stringify(message)}\n`);
      if (!ok) this.child.stdin?.once("drain", () => undefined);
    });
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    if (this.closed) return;
    this.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  close(): void {
    this.closed = true;
    this.child.stdout?.removeListener("data", this.stdoutListener);
    this.child.stdout?.removeListener("close", this.closeListener);
    this.closeAllPending(new Error("rpc client closed by test"));
  }

  private closeAllPending(err: Error): void {
    for (const { reject: rejectPending } of this.pending.values()) rejectPending(err);
    this.pending.clear();
  }

  private onStdoutChunk(chunk: Buffer): void {
    this.buffer += chunk.toString("utf-8");
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const message = parsed as Partial<RpcResponse>;
      if (typeof message !== "object" || message === null) continue;
      if (message.jsonrpc !== "2.0") continue;
      if (message.id === undefined) continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      pending.resolve(message as RpcResponse);
    }
  }
}

type ExitOutcome = { kind: "exit"; code: number | null; signal: NodeJS.Signals | null } | { kind: "timeout" };

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<ExitOutcome> {
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

describe("built CLI mcp-server smoke (tools registered through onLoad)", () => {
  let projectDir: string;
  let stateDir: string;
  let homeDir: string;
  let child: ChildProcess | null;
  let stderrChunks: Buffer[];

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-built-cli-mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

  it("`node dist/cli.js mcp-server` advertises a non-empty tool list (registerTool ran in onLoad)", async () => {
    child = spawn(
      process.execPath,
      [CLI_PATH, "mcp-server"],
      {
        cwd: projectDir,
        env: {
          ...process.env,
          HOME: homeDir,
          NODE_OPTIONS: "",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    child.stderr?.on("data", (d) => stderrChunks.push(Buffer.from(d)));

    const rpc = new JsonRpcStdio(child);

    try {
      const initResponse = await rpc.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "smoke-test", version: "0" },
      });
      expect(
        initResponse.error,
        `initialize returned an error: ${JSON.stringify(initResponse.error)}; ` +
          `stderr:\n${Buffer.concat(stderrChunks).toString()}`,
      ).toBeUndefined();
      const initResult = initResponse.result as {
        serverInfo?: { name?: string };
        capabilities?: { tools?: unknown };
      };
      expect(initResult.serverInfo?.name).toBe("kota");
      expect(initResult.capabilities?.tools).toBeDefined();

      rpc.notify("notifications/initialized");

      const toolsResponse = await rpc.request("tools/list", {});
      expect(
        toolsResponse.error,
        `tools/list returned an error: ${JSON.stringify(toolsResponse.error)}; ` +
          `stderr:\n${Buffer.concat(stderrChunks).toString()}`,
      ).toBeUndefined();
      const toolsResult = toolsResponse.result as { tools?: Array<{ name: string }> };
      expect(Array.isArray(toolsResult.tools)).toBe(true);
      expect(
        toolsResult.tools?.length ?? 0,
        `expected non-empty tool list (proves registerTool ran via onLoad); ` +
          `tools: ${JSON.stringify(toolsResult.tools)}; ` +
          `stderr:\n${Buffer.concat(stderrChunks).toString()}`,
      ).toBeGreaterThan(0);
    } finally {
      rpc.close();
    }

    child.kill("SIGTERM");
    const outcome = await waitForExit(child, 10_000);
    expect(
      outcome.kind === "exit" && (outcome.code === 0 || outcome.signal === "SIGTERM"),
      `mcp-server did not exit within 10s after SIGTERM; outcome=${JSON.stringify(outcome)}; ` +
        `stderr:\n${Buffer.concat(stderrChunks).toString()}`,
    ).toBe(true);
  }, 60_000);
});
