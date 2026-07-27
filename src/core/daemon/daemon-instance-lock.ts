import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JsonFileError, readOptionalJsonFile } from "#core/util/json-file.js";
import { isProcessAlive } from "#core/util/process-alive.js";
import { detectStrandedDaemonProcess } from "./stranded-daemon.js";

export const CONTROL_FILE = "daemon-control.json";

export type DaemonControlFilePayload = {
  port: number;
  pid: number;
  startedAt: string;
  token: string;
};

export type DaemonInstanceIdentity = Pick<
  DaemonControlFilePayload,
  "pid" | "startedAt" | "token"
>;

/**
 * Check for an existing daemon instance before starting. If a live daemon
 * owns the project, refuse to start. Only a dead owner PID makes the control
 * file stale enough to remove automatically.
 */
export async function acquireInstanceLock(
  projectDir: string,
  stateDir: string,
  log: (message: string) => void,
): Promise<void> {
  const stranded = detectStrandedDaemonProcess(projectDir);
  if (stranded.kind === "stranded") {
    throw new Error(
      `A stranded daemon process is already running (pid ${stranded.pid}) but has no control API. ` +
        "Terminate it before starting a new daemon.",
    );
  }

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
    let response: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2_000);
      response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
    } catch (cause) {
      throw new Error(
        `Daemon process ${pid} is alive but its control API on port ${port} is unreachable. ` +
          "Terminate that process before starting a replacement.",
        { cause },
      );
    }
    if (!response.ok) {
      throw new Error(
        `Daemon process ${pid} is alive but its control API on port ${port} returned HTTP ${response.status}. ` +
          "Terminate that process before starting a replacement.",
      );
    }
    throw new Error(
      `Another daemon instance is already running (pid ${pid}, port ${port}). ` +
        `Stop it with 'kota daemon stop' before starting a new one.`,
    );
  }

  throw new Error(
    `Daemon process ${pid} is alive but its control file has no port. ` +
      "Terminate that process before starting a replacement.",
  );
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

export function releaseInstanceLock(
  stateDir: string,
  owner: DaemonInstanceIdentity,
): void {
  const controlPath = join(stateDir, CONTROL_FILE);
  const current = readOptionalJsonFile<DaemonControlFilePayload>(controlPath);
  if (
    current === null ||
    current.pid !== owner.pid ||
    current.startedAt !== owner.startedAt ||
    current.token !== owner.token
  ) {
    return;
  }
  rmSync(controlPath);
}
