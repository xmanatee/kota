import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JsonFileError, readOptionalJsonFile } from "#core/util/json-file.js";
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
  const controlPath = join(stateDir, CONTROL_FILE);
  const tmpPath = `${controlPath}.tmp`;

  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    chmodSync(stateDir, 0o700);
    rmSync(tmpPath, { force: true });
    writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
    });
    chmodSync(tmpPath, 0o600);
    renameSync(tmpPath, controlPath);
    chmodSync(controlPath, 0o600);
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : String(error);
    throw new JsonFileError(controlPath, "write", `failed to write daemon control file securely: ${message}`);
  }
}

export function releaseInstanceLock(stateDir: string): void {
  const controlPath = join(stateDir, CONTROL_FILE);
  if (existsSync(controlPath)) rmSync(controlPath);
}
