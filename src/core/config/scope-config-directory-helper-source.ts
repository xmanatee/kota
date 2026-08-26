/*
 * Node does not expose openat(2)/renameat(2). This helper enters the verified
 * directory in an isolated process, verifies "." against the expected inode,
 * and then uses relative paths exclusively. The process working directory is
 * a stable kernel reference even if the scope path is concurrently renamed
 * or replaced.
 */
import { DIRECTORY_ANCHOR_HELPER_SOURCE } from "./scope-config-directory-anchor-helper-source.js";

export const DIRECTORY_HELPER_SOURCE = `
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";

const CONFIG_FILENAME = "config.json";
const CONFIG_DIRECTORY = ".kota";
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

function identity(stats) {
  return { dev: stats.dev, ino: stats.ino };
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function refuse(reason) {
  const error = new Error(reason);
  error.safeReason = reason;
  throw error;
}

function lstatOptional(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function validateIdentity(value, field) {
  if (
    value === null ||
    typeof value !== "object" ||
    !Number.isSafeInteger(value.dev) ||
    !Number.isSafeInteger(value.ino)
  ) {
    refuse(field + " is invalid");
  }
}

${DIRECTORY_ANCHOR_HELPER_SOURCE}

function inspectConfigFile(expectedIdentity) {
  const pathStats = lstatOptional(CONFIG_FILENAME);
  if (pathStats === undefined) {
    if (expectedIdentity !== undefined && expectedIdentity !== null) {
      refuse("config file changed during the update");
    }
    return undefined;
  }
  if (pathStats.isSymbolicLink()) {
    refuse("config file must not be a symbolic link");
  }
  if (!pathStats.isFile()) {
    refuse("config file must be a regular file");
  }
  if (pathStats.nlink !== 1) {
    refuse("config file must not have multiple hard links");
  }
  if (expectedIdentity === null) {
    refuse("config file changed during the update");
  }

  const fd = openSync(
    CONFIG_FILENAME,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const openedStats = fstatSync(fd);
    if (
      !openedStats.isFile() ||
      openedStats.nlink !== 1 ||
      !sameFile(openedStats, identity(pathStats)) ||
      (expectedIdentity !== undefined &&
        !sameFile(openedStats, expectedIdentity))
    ) {
      refuse("config file changed during the update");
    }
    return { fd, identity: identity(openedStats) };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function readConfig(request, directoryFd) {
  inspectScopeRoot(request);
  const openedConfig = inspectConfigFile(undefined);
  try {
    inspectScopeRoot(request);
    fchmodSync(directoryFd, DIRECTORY_MODE);
    if (openedConfig === undefined) {
      return { exists: false };
    }
    inspectScopeRoot(request);
    fchmodSync(openedConfig.fd, FILE_MODE);
    return {
      exists: true,
      contents: readFileSync(openedConfig.fd, "utf8"),
      identity: openedConfig.identity,
    };
  } finally {
    if (openedConfig !== undefined) closeSync(openedConfig.fd);
  }
}

function cleanupTemporaryFile(name, expectedIdentity) {
  if (expectedIdentity === undefined) return;
  try {
    const current = lstatOptional(name);
    if (
      current !== undefined &&
      current.isFile() &&
      sameFile(current, expectedIdentity)
    ) {
      unlinkSync(name);
    }
  } catch {
    // Preserve the original failure without unlinking an unverified entry.
  }
}

function writeConfig(request, directoryFd) {
  if (typeof request.serializedConfig !== "string") {
    refuse("serialized config is invalid");
  }
  if (request.expectedConfigIdentity !== null) {
    validateIdentity(
      request.expectedConfigIdentity,
      "expected config identity",
    );
  }

  inspectScopeRoot(request);
  const initialConfig = inspectConfigFile(
    request.expectedConfigIdentity,
  );
  if (initialConfig !== undefined) closeSync(initialConfig.fd);
  inspectScopeRoot(request);
  fchmodSync(directoryFd, DIRECTORY_MODE);

  const temporaryName =
    "." +
    CONFIG_FILENAME +
    "." +
    process.pid +
    "." +
    randomUUID() +
    ".tmp";
  let temporaryFd;
  let temporaryIdentity;
  let renamed = false;

  try {
    inspectScopeRoot(request);
    temporaryFd = openSync(
      temporaryName,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      FILE_MODE,
    );
    const temporaryStats = fstatSync(temporaryFd);
    if (!temporaryStats.isFile() || temporaryStats.nlink !== 1) {
      refuse("temporary config is not a private regular file");
    }
    temporaryIdentity = identity(temporaryStats);
    inspectScopeRoot(request);
    fchmodSync(temporaryFd, FILE_MODE);
    writeFileSync(temporaryFd, request.serializedConfig, "utf8");
    fsyncSync(temporaryFd);

    inspectScopeRoot(request);
    const currentConfig = inspectConfigFile(
      request.expectedConfigIdentity,
    );
    if (currentConfig !== undefined) closeSync(currentConfig.fd);
    inspectScopeRoot(request);
    renameSync(temporaryName, CONFIG_FILENAME);
    renamed = true;

    const installedStats = lstatSync(CONFIG_FILENAME);
    if (
      !installedStats.isFile() ||
      installedStats.nlink !== 1 ||
      !sameFile(installedStats, temporaryIdentity)
    ) {
      refuse("installed config is not the private temporary file");
    }
    inspectScopeRoot(request);
    fsyncSync(directoryFd);
  } finally {
    if (temporaryFd !== undefined) closeSync(temporaryFd);
    if (!renamed) cleanupTemporaryFile(temporaryName, temporaryIdentity);
  }
}

function respond(response) {
  process.stdout.write(JSON.stringify(response));
}

try {
  const request = JSON.parse(readFileSync(0, "utf8"));
  if (
    request === null ||
    typeof request !== "object" ||
    (request.operation !== "ensureDirectory" &&
      request.operation !== "read" &&
      request.operation !== "write") ||
    typeof request.scopeRootPath !== "string"
  ) {
    refuse("filesystem request is invalid");
  }
  validateIdentity(request.scopeRootIdentity, "scope root identity");
  if (request.operation !== "ensureDirectory") {
    validateIdentity(request.directoryIdentity, "directory identity");
  }

  const scopeRootFd = anchorScopeRoot(request);
  try {
    if (request.operation === "ensureDirectory") {
      respond({
        ok: true,
        directoryIdentity: ensureConfigDirectory(request),
      });
    } else {
      const directoryFd = anchorConfigDirectory(request);
      try {
        if (request.operation === "read") {
          respond({ ok: true, snapshot: readConfig(request, directoryFd) });
        } else {
          writeConfig(request, directoryFd);
          respond({ ok: true });
        }
      } finally {
        closeSync(directoryFd);
      }
    }
  } finally {
    closeSync(scopeRootFd);
  }
} catch (error) {
  const reason =
    error && typeof error.safeReason === "string"
      ? error.safeReason
      : "filesystem operation failed (" +
        (error && typeof error.code === "string" ? error.code : "unknown") +
        ")";
  respond({ ok: false, reason });
}
`;
