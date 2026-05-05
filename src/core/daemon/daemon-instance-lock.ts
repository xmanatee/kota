import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readOptionalJsonFile, writeJsonFileAtomic } from "#core/util/json-file.js";
import { isProcessAlive } from "#core/util/process-alive.js";

export const CONTROL_FILE = "daemon-control.json";

export type DaemonControlFilePayload = {
  port: number;
  pid: number;
  startedAt: string;
  token: string;
};

/**
 * Check for an existing daemon instance before starting. If a live daemon
 * owns the project, refuse to start. If the control file is stale (dead PID
 * or unreachable port), clean it up and proceed.
 */
export async function acquireInstanceLock(
  stateDir: string,
  log: (message: string) => void,
): Promise<void> {
  const controlPath = join(stateDir, CONTROL_FILE);
  const existing = readOptionalJsonFile<{ port?: number; pid?: number; token?: string }>(controlPath);
  if (!existing || typeof existing.pid !== "number") return;

  const pid = existing.pid;
  const port = existing.port;

  if (!isProcessAlive(pid)) {
    log(`Removing stale control file (pid ${pid} is not alive)`);
    rmSync(controlPath, { force: true });
    return;
  }

  if (typeof port === "number") {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2_000);
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      if (res.ok) {
        throw new Error(
          `Another daemon instance is already running (pid ${pid}, port ${port}). ` +
          `Stop it with 'kota daemon stop' before starting a new one.`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Another daemon instance")) {
        throw err;
      }
      log(`Control file references pid ${pid} (alive) but port ${port} is unreachable — removing stale control file`);
      rmSync(controlPath, { force: true });
      return;
    }
  }

  log(`Control file references pid ${pid} (alive) but has no port — removing stale control file`);
  rmSync(controlPath, { force: true });
}

export function writeControlFile(stateDir: string, payload: DaemonControlFilePayload): void {
  writeJsonFileAtomic(join(stateDir, CONTROL_FILE), payload);
}

export function releaseInstanceLock(stateDir: string): void {
  const controlPath = join(stateDir, CONTROL_FILE);
  if (existsSync(controlPath)) rmSync(controlPath);
}
