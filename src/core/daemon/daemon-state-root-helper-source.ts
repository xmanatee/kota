import { DAEMON_STATE_ROOT_ANCHOR_HELPER_SOURCE } from "./daemon-state-root-anchor-helper-source.js";

/**
 * Node does not expose openat(2). The isolated helper anchors its working
 * directory to verified project/state inodes, then uses relative paths and
 * no-follow descriptors for daemon ownership files.
 */
export const DAEMON_STATE_ROOT_HELPER_SOURCE = `
import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

const STATE_DIRECTORY = ".kota";
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const OWNERSHIP_FILES = new Set([
  "daemon-instance.lock",
  "daemon-control.json",
]);

${DAEMON_STATE_ROOT_ANCHOR_HELPER_SOURCE}

function inspectOwnershipFile(filename) {
  const pathStats = lstatOptional(filename);
  if (pathStats === undefined) return undefined;
  if (pathStats.isSymbolicLink()) refuse(filename + " must not be a symbolic link");
  if (!pathStats.isFile() || pathStats.nlink !== 1) {
    refuse(filename + " must be a private regular file");
  }
  const fd = openSync(
    filename,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const openedStats = fstatSync(fd);
    if (
      !openedStats.isFile() ||
      openedStats.nlink !== 1 ||
      !sameFile(identity(openedStats), identity(pathStats))
    ) {
      refuse(filename + " changed while it was opened");
    }
    return { fd, identity: identity(openedStats) };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function readOwnershipFile(filename) {
  const opened = inspectOwnershipFile(filename);
  if (opened === undefined) return { exists: false };
  try {
    return {
      exists: true,
      contents: readFileSync(opened.fd, "utf8"),
      identity: opened.identity,
    };
  } finally {
    closeSync(opened.fd);
  }
}

function createOwnershipFile(filename, contents, directoryFd) {
  if (lstatOptional(filename) !== undefined) return false;
  const temporaryName = "." + filename + "." + process.pid + "." + randomUUID() + ".tmp";
  let temporaryFd;
  let temporaryIdentity;
  let installed = false;
  try {
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
      refuse("temporary daemon ownership file is not private");
    }
    temporaryIdentity = identity(temporaryStats);
    fchmodSync(temporaryFd, FILE_MODE);
    writeFileSync(temporaryFd, contents, "utf8");
    fsyncSync(temporaryFd);
    try {
      linkSync(temporaryName, filename);
    } catch (error) {
      if (error && error.code === "EEXIST") return false;
      throw error;
    }
    installed = true;
    unlinkSync(temporaryName);
    const installedStats = lstatSync(filename);
    if (
      !installedStats.isFile() ||
      installedStats.nlink !== 1 ||
      !sameFile(identity(installedStats), temporaryIdentity)
    ) {
      refuse("installed daemon ownership file changed during publication");
    }
    fsyncSync(directoryFd);
    return true;
  } finally {
    if (temporaryFd !== undefined) closeSync(temporaryFd);
    if (!installed) {
      const temporaryStats = lstatOptional(temporaryName);
      if (
        temporaryStats !== undefined &&
        temporaryIdentity !== undefined &&
        sameFile(identity(temporaryStats), temporaryIdentity)
      ) {
        unlinkSync(temporaryName);
      }
    }
  }
}

function removeOwnershipFile(filename, expectedIdentity, directoryFd) {
  const opened = inspectOwnershipFile(filename);
  if (opened === undefined) return false;
  closeSync(opened.fd);
  if (!sameFile(opened.identity, expectedIdentity)) return false;
  unlinkSync(filename);
  fsyncSync(directoryFd);
  return true;
}

function respond(response) {
  process.stdout.write(JSON.stringify(response));
}

try {
  const request = JSON.parse(readFileSync(0, "utf8"));
  if (
    request === null ||
    typeof request !== "object" ||
    !["ensure", "read", "create", "remove"].includes(request.operation) ||
    typeof request.scopeRootPath !== "string"
  ) {
    refuse("daemon state filesystem request is invalid");
  }
  validateIdentity(request.scopeRootIdentity, "scope root identity");
  if (request.operation !== "ensure") {
    validateIdentity(request.directoryIdentity, "state directory identity");
    if (!OWNERSHIP_FILES.has(request.filename)) {
      refuse("daemon ownership filename is invalid");
    }
  }
  if (request.operation === "create" && typeof request.contents !== "string") {
    refuse("daemon ownership contents are invalid");
  }
  if (request.operation === "remove") {
    validateIdentity(request.expectedIdentity, "ownership file identity");
  }

  const scopeRootFd = anchorScopeRoot(request);
  try {
    if (request.operation === "ensure") {
      respond({ ok: true, directoryIdentity: ensureStateDirectory(request) });
    } else {
      const directoryFd = anchorStateDirectory(request);
      try {
        if (request.operation === "read") {
          respond({ ok: true, snapshot: readOwnershipFile(request.filename) });
        } else if (request.operation === "create") {
          respond({
            ok: true,
            created: createOwnershipFile(request.filename, request.contents, directoryFd),
          });
        } else {
          respond({
            ok: true,
            removed: removeOwnershipFile(
              request.filename,
              request.expectedIdentity,
              directoryFd,
            ),
          });
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
