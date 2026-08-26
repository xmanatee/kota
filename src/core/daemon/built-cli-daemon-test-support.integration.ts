import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ControlAddress = { port: number; token: string; startedAt: string };

export async function pollControlFile(
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
    const tick = new Promise<"tick">((resolveTick) => setTimeout(() => resolveTick("tick"), 100));
    const result = await Promise.race([tick, exitWatcher]);
    if (typeof result === "object" && result !== null && "exitSentinel" in result) {
      throw new Error(
        `daemon exited (code=${(result as { code: number }).code}) before publishing daemon-control.json`,
      );
    }
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${controlPath} to appear.`);
}

export async function pollControlFileReplacement(
  stateDir: string,
  previous: ControlAddress,
  timeoutMs: number,
  earlyExit: Promise<number>,
): Promise<ControlAddress> {
  const deadline = Date.now() + timeoutMs;
  const exitSentinel = Symbol("exit");
  const exitWatcher = earlyExit.then((code) => ({ exitSentinel, code }));

  while (Date.now() < deadline) {
    const tick = new Promise<"tick">((resolveTick) => setTimeout(() => resolveTick("tick"), 100));
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
      current.port !== previous.port
      || current.token !== previous.token
      || current.startedAt !== previous.startedAt
    ) {
      return current;
    }
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for daemon-control.json to be replaced after restart.`,
  );
}

export async function fetchAuthorized(
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

export function writeRestartRegressionModule(stateDir: string): void {
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
      repository: "none",
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

export async function waitForExit(
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
