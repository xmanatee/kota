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
import {
  createAnchoredDaemonOwnershipFile,
  type DaemonOwnershipFilename,
  type DaemonStateRoot,
  type FileIdentity,
  readAnchoredDaemonOwnershipFile,
  removeAnchoredDaemonOwnershipFile,
} from "./daemon-state-root.js";

type FileSystemError = Error & { code?: string };

export type DaemonOwnershipJsonValue =
  | string
  | number
  | boolean
  | null
  | DaemonOwnershipJsonValue[]
  | { [key: string]: DaemonOwnershipJsonValue | undefined };

export type DaemonOwnershipFileSnapshot = {
  value: DaemonOwnershipJsonValue;
  identity: FileIdentity | undefined;
};

function ensurePrivateConfiguredStateDir(stateDir: string): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  chmodSync(stateDir, 0o700);
}

function parseJsonFile(path: string, raw: string): DaemonOwnershipJsonValue {
  try {
    return JSON.parse(raw) as DaemonOwnershipJsonValue;
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : String(error);
    throw new JsonFileError(path, "parse", `invalid JSON: ${message}`);
  }
}

export function readDaemonOwnershipFile(
  stateRoot: DaemonStateRoot,
  filename: DaemonOwnershipFilename,
): DaemonOwnershipFileSnapshot | null {
  const path = join(stateRoot.path, filename);
  if (stateRoot.kind === "operator-configured") {
    const value = readOptionalJsonFile<DaemonOwnershipJsonValue>(path);
    return value === null ? null : { value, identity: undefined };
  }
  const snapshot = readAnchoredDaemonOwnershipFile(stateRoot, filename);
  return snapshot.exists
    ? { value: parseJsonFile(path, snapshot.contents), identity: snapshot.identity }
    : null;
}

export function removeDaemonOwnershipFile(
  stateRoot: DaemonStateRoot,
  filename: DaemonOwnershipFilename,
  fileIdentity: FileIdentity | undefined,
): boolean {
  if (stateRoot.kind === "operator-configured") {
    rmSync(join(stateRoot.path, filename), { force: true });
    return true;
  }
  if (fileIdentity === undefined) {
    throw new Error("anchored daemon ownership file is missing its identity");
  }
  return removeAnchoredDaemonOwnershipFile(stateRoot, filename, fileIdentity);
}

export function reserveDaemonInstanceLockFile(
  stateRoot: DaemonStateRoot,
  filename: DaemonOwnershipFilename,
  contents: string,
): boolean {
  const lockPath = join(stateRoot.path, filename);
  if (stateRoot.kind === "project-owned") {
    try {
      return createAnchoredDaemonOwnershipFile(stateRoot, filename, contents);
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : String(error);
      throw new JsonFileError(
        lockPath,
        "write",
        `failed to reserve daemon instance lock securely: ${message}`,
      );
    }
  }

  ensurePrivateConfiguredStateDir(stateRoot.path);
  const temporaryPath = `${lockPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, contents, {
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

export function publishDaemonControlFile(
  stateRoot: DaemonStateRoot,
  filename: DaemonOwnershipFilename,
  contents: string,
): void {
  const controlPath = join(stateRoot.path, filename);
  if (stateRoot.kind === "project-owned") {
    try {
      if (!createAnchoredDaemonOwnershipFile(stateRoot, filename, contents)) {
        throw new Error("daemon control file appeared during secure publication");
      }
      return;
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : String(error);
      throw new JsonFileError(
        controlPath,
        "write",
        `failed to write daemon control file securely: ${message}`,
      );
    }
  }

  const tmpPath = `${controlPath}.tmp`;
  try {
    ensurePrivateConfiguredStateDir(stateRoot.path);
    rmSync(tmpPath, { force: true });
    writeFileSync(tmpPath, contents, {
      encoding: "utf-8",
      mode: 0o600,
    });
    chmodSync(tmpPath, 0o600);
    renameSync(tmpPath, controlPath);
    chmodSync(controlPath, 0o600);
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : String(error);
    throw new JsonFileError(
      controlPath,
      "write",
      `failed to write daemon control file securely: ${message}`,
    );
  }
}
