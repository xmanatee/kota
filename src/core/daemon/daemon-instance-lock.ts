import { randomUUID } from "node:crypto";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { JsonFileError, readOptionalJsonFile } from "#core/util/json-file.js";
import { isProcessAlive } from "#core/util/process-alive.js";
import { detectStrandedDaemonProcess } from "./stranded-daemon.js";

export const CONTROL_FILE = "daemon-control.json";
export const INSTANCE_LOCK_FILE = "daemon-instance.lock";

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

type FileSystemError = Error & { code?: string };
type InstanceLockJsonValue =
  | string
  | number
  | boolean
  | null
  | InstanceLockJsonValue[]
  | { [key: string]: InstanceLockJsonValue | undefined };
type InstanceLockJsonObject = {
  [key: string]: InstanceLockJsonValue | undefined;
};

function ownerMatches(
  current: DaemonInstanceIdentity,
  owner: DaemonInstanceIdentity,
): boolean {
  return (
    current.pid === owner.pid &&
    current.startedAt === owner.startedAt &&
    current.token === owner.token
  );
}

function isJsonObject(
  value: InstanceLockJsonValue | undefined,
): value is InstanceLockJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInstanceIdentity(
  value: InstanceLockJsonValue | undefined,
): value is DaemonInstanceIdentity & InstanceLockJsonObject {
  if (!isJsonObject(value)) return false;
  return (
    typeof value.pid === "number" &&
    Number.isSafeInteger(value.pid) &&
    value.pid > 0 &&
    typeof value.startedAt === "string" &&
    value.startedAt.length > 0 &&
    typeof value.token === "string" &&
    value.token.length > 0
  );
}

function ensurePrivateStateDir(stateDir: string): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  chmodSync(stateDir, 0o700);
}

function readInstanceOwner(lockPath: string): DaemonInstanceIdentity | null {
  const value = readOptionalJsonFile<InstanceLockJsonValue>(lockPath);
  if (value === null) return null;
  if (!isInstanceIdentity(value)) {
    throw new JsonFileError(lockPath, "parse", "daemon instance lock is invalid");
  }
  return value;
}

function tryReserveInstanceLock(
  stateDir: string,
  owner: DaemonInstanceIdentity,
): boolean {
  ensurePrivateStateDir(stateDir);
  const lockPath = join(stateDir, INSTANCE_LOCK_FILE);
  const temporaryPath = `${lockPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(owner, null, 2)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
      flag: "wx",
    });
    try {
      linkSync(temporaryPath, lockPath);
      chmodSync(lockPath, 0o600);
      return true;
    } catch (error) {
      if ((error as FileSystemError).code === "EEXIST") return false;
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error && error.message
      ? error.message
      : String(error);
    throw new JsonFileError(
      lockPath,
      "write",
      `failed to reserve daemon instance lock securely: ${message}`,
    );
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

/**
 * Reserve the project before asynchronous startup and reject any live owner.
 * A dead owner PID is the only automatic stale-lock or stale-control cleanup
 * condition.
 */
export async function acquireInstanceLock(
  projectDir: string,
  stateDir: string,
  owner: DaemonInstanceIdentity,
  log: (message: string) => void,
): Promise<void> {
  const stranded = detectStrandedDaemonProcess(projectDir);
  if (stranded.kind === "stranded") {
    throw new Error(
      `A stranded daemon process is already running (pid ${stranded.pid}) but has no control API. ` +
        "Terminate it before starting a new daemon.",
    );
  }

  const lockPath = join(stateDir, INSTANCE_LOCK_FILE);
  while (!tryReserveInstanceLock(stateDir, owner)) {
    const current = readInstanceOwner(lockPath);
    if (current === null) continue;
    if (isProcessAlive(current.pid)) {
      throw new Error(
        `Another daemon instance is starting or running (pid ${current.pid}). ` +
          "Terminate it before starting a replacement.",
      );
    }
    const latest = readInstanceOwner(lockPath);
    if (latest === null || !ownerMatches(latest, current)) continue;
    log(`Removing stale instance lock (pid ${current.pid} is not alive)`);
    rmSync(lockPath);
  }

  const controlPath = join(stateDir, CONTROL_FILE);
  const existing = readOptionalJsonFile<InstanceLockJsonValue>(controlPath);
  if (existing !== null) {
    if (
      !isJsonObject(existing) ||
      typeof existing.pid !== "number" ||
      !Number.isSafeInteger(existing.pid) ||
      existing.pid <= 0
    ) {
      throw new JsonFileError(controlPath, "parse", "daemon control file is invalid");
    }
    const pid = existing.pid;
    const port = existing.port;
    if (!isProcessAlive(pid)) {
      log(`Removing stale control file (pid ${pid} is not alive)`);
      rmSync(controlPath, { force: true });
    } else if (
      typeof port !== "number" ||
      !Number.isSafeInteger(port) ||
      port <= 0 ||
      port > 65_535 ||
      typeof existing.startedAt !== "string" ||
      existing.startedAt.length === 0 ||
      typeof existing.token !== "string" ||
      existing.token.length === 0
    ) {
      throw new Error(
        `Daemon process ${pid} is alive but its control file is incomplete. ` +
          "Terminate that process before starting a replacement.",
      );
    } else {
      let response: Response;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2_000);
        response = await fetch(`http://127.0.0.1:${port}/identity`, {
          headers: { Authorization: `Bearer ${existing.token}` },
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
      let identity: InstanceLockJsonValue;
      try {
        identity = await response.json();
      } catch (cause) {
        throw new Error(
          `Daemon process ${pid} is alive but its control API returned invalid identity data. ` +
            "Terminate that process before starting a replacement.",
          { cause },
        );
      }
      if (
        !isJsonObject(identity) ||
        identity.pid !== pid ||
        identity.startedAt !== existing.startedAt
      ) {
        throw new Error(
          `Daemon process ${pid} is alive but its control API identity does not match its control file. ` +
            "Terminate that process before starting a replacement.",
        );
      }
      throw new Error(
        `Another daemon instance is already running (pid ${pid}, port ${port}). ` +
          `Stop it with 'kota daemon stop' before starting a new one.`,
      );
    }
  }
}

export function writeControlFile(stateDir: string, payload: DaemonControlFilePayload): void {
  const controlPath = join(stateDir, CONTROL_FILE);
  const tmpPath = `${controlPath}.tmp`;

  try {
    ensurePrivateStateDir(stateDir);
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
  const lockPath = join(stateDir, INSTANCE_LOCK_FILE);
  const lockOwner = readInstanceOwner(lockPath);
  if (lockOwner !== null && ownerMatches(lockOwner, owner)) rmSync(lockPath);

  const controlPath = join(stateDir, CONTROL_FILE);
  const current = readOptionalJsonFile<DaemonControlFilePayload>(controlPath);
  if (current !== null && ownerMatches(current, owner)) rmSync(controlPath);
}
