import { join } from "node:path";
import { JsonFileError } from "#core/util/json-file.js";
import { isProcessAlive } from "#core/util/process-alive.js";
import {
  type DaemonOwnershipFileSnapshot,
  type DaemonOwnershipJsonValue,
  publishDaemonControlFile,
  readDaemonOwnershipFile,
  removeDaemonOwnershipFile,
  reserveDaemonInstanceLockFile,
} from "./daemon-ownership-storage.js";
import type { DaemonStateRoot } from "./daemon-state-root.js";
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

type InstanceLockJsonObject = {
  [key: string]: DaemonOwnershipJsonValue | undefined;
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
  value: DaemonOwnershipJsonValue | undefined,
): value is InstanceLockJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInstanceIdentity(
  value: DaemonOwnershipJsonValue | undefined,
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

function readInstanceOwner(
  stateRoot: DaemonStateRoot,
): (DaemonOwnershipFileSnapshot & { value: DaemonInstanceIdentity }) | null {
  const path = join(stateRoot.path, INSTANCE_LOCK_FILE);
  const snapshot = readDaemonOwnershipFile(stateRoot, INSTANCE_LOCK_FILE);
  if (snapshot === null) return null;
  if (!isInstanceIdentity(snapshot.value)) {
    throw new JsonFileError(path, "parse", "daemon instance lock is invalid");
  }
  return { ...snapshot, value: snapshot.value };
}

function tryReserveInstanceLock(
  stateRoot: DaemonStateRoot,
  owner: DaemonInstanceIdentity,
): boolean {
  const contents = `${JSON.stringify(owner, null, 2)}\n`;
  return reserveDaemonInstanceLockFile(
    stateRoot,
    INSTANCE_LOCK_FILE,
    contents,
  );
}

/**
 * Reserve the project before asynchronous startup and reject any live owner.
 * A dead owner PID is the only automatic stale-lock or stale-control cleanup
 * condition.
 */
export async function acquireInstanceLock(
  projectDir: string,
  stateRoot: DaemonStateRoot,
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

  while (!tryReserveInstanceLock(stateRoot, owner)) {
    const current = readInstanceOwner(stateRoot);
    if (current === null) continue;
    if (isProcessAlive(current.value.pid)) {
      throw new Error(
        `Another daemon instance is starting or running (pid ${current.value.pid}). ` +
          "Terminate it before starting a replacement.",
      );
    }
    const latest = readInstanceOwner(stateRoot);
    if (latest === null || !ownerMatches(latest.value, current.value)) continue;
    log(`Removing stale instance lock (pid ${current.value.pid} is not alive)`);
    removeDaemonOwnershipFile(stateRoot, INSTANCE_LOCK_FILE, latest.identity);
  }

  const controlPath = join(stateRoot.path, CONTROL_FILE);
  const existingSnapshot = readDaemonOwnershipFile(stateRoot, CONTROL_FILE);
  if (existingSnapshot !== null) {
    const existing = existingSnapshot.value;
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
      removeDaemonOwnershipFile(stateRoot, CONTROL_FILE, existingSnapshot.identity);
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
      let identity: DaemonOwnershipJsonValue;
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

export function writeControlFile(
  stateRoot: DaemonStateRoot,
  payload: DaemonControlFilePayload,
): void {
  const contents = `${JSON.stringify(payload, null, 2)}\n`;
  publishDaemonControlFile(stateRoot, CONTROL_FILE, contents);
}

export function releaseInstanceLock(
  stateRoot: DaemonStateRoot,
  owner: DaemonInstanceIdentity,
): void {
  const lockOwner = readInstanceOwner(stateRoot);
  if (lockOwner !== null && ownerMatches(lockOwner.value, owner)) {
    removeDaemonOwnershipFile(stateRoot, INSTANCE_LOCK_FILE, lockOwner.identity);
  }

  const current = readDaemonOwnershipFile(stateRoot, CONTROL_FILE);
  if (
    current !== null &&
    isInstanceIdentity(current.value) &&
    ownerMatches(current.value, owner)
  ) {
    removeDaemonOwnershipFile(stateRoot, CONTROL_FILE, current.identity);
  }
}
