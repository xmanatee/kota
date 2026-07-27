/**
 * The helper anchors itself inside the verified directory before touching the
 * secret file. Relative operations then keep using that directory inode even
 * if an attacker concurrently replaces one of its pathname components.
 */
export const SECRET_FILE_STORAGE_HELPER_SOURCE = `
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, relative, sep } from "node:path";
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
function inspectDirectory(request) {
  const pathStats = lstatSync(request.directoryPath);
  if (pathStats.isSymbolicLink()) {
    refuse("secret directory must not be a symbolic link");
  }
  if (!pathStats.isDirectory()) {
    refuse("secret directory must be a directory");
  }
  if (!sameFile(identity(pathStats), request.directoryIdentity)) {
    refuse("secret directory changed during the operation");
  }
  if (realpathSync.native(request.directoryPath) !== request.directoryPath) {
    refuse("secret directory escaped its intended path");
  }
}
function anchorDirectory(request) {
  inspectDirectory(request);
  const fd = openSync(
    request.directoryPath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const openedStats = fstatSync(fd);
    if (
      !openedStats.isDirectory() ||
      !sameFile(identity(openedStats), request.directoryIdentity)
    ) {
      refuse("secret directory changed while it was opened");
    }
    process.chdir(request.directoryPath);
    if (!sameFile(identity(statSync(".")), request.directoryIdentity)) {
      refuse("secret directory changed while it was anchored");
    }
    inspectDirectory(request);
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}
function verifyContainedFile(request, filename, expectedIdentity) {
  inspectDirectory(request);
  const directory = realpathSync.native(".");
  const candidate = realpathSync.native(filename);
  const relativePath = relative(directory, candidate);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(".." + sep) ||
    isAbsolute(relativePath) ||
    !sameFile(identity(lstatSync(filename)), expectedIdentity)
  ) {
    refuse("secret file escaped its intended directory");
  }
}
function inspectSecretFile(request, expectedIdentity) {
  inspectDirectory(request);
  const pathStats = lstatOptional(request.filename);
  if (pathStats === undefined) {
    if (expectedIdentity !== undefined && expectedIdentity !== null) {
      refuse("secret file changed during the operation");
    }
    return undefined;
  }
  if (pathStats.isSymbolicLink()) {
    refuse("secret file must not be a symbolic link");
  }
  if (!pathStats.isFile()) refuse("secret file must be a regular file");
  if (pathStats.nlink !== 1) {
    refuse("secret file must not have multiple hard links");
  }
  if (expectedIdentity === null) {
    refuse("secret file changed during the operation");
  }

  const fd = openSync(
    request.filename,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const openedStats = fstatSync(fd);
    const openedIdentity = identity(openedStats);
    if (
      !openedStats.isFile() ||
      openedStats.nlink !== 1 ||
      !sameFile(identity(pathStats), openedIdentity) ||
      (expectedIdentity !== undefined &&
        !sameFile(expectedIdentity, openedIdentity))
    ) {
      refuse("secret file changed while it was opened");
    }
    verifyContainedFile(request, request.filename, openedIdentity);
    return { fd, identity: openedIdentity };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}
function readSecretFile(request, directoryFd) {
  const openedFile = inspectSecretFile(request, undefined);
  inspectDirectory(request);
  fchmodSync(directoryFd, DIRECTORY_MODE);
  if (openedFile === undefined) return { exists: false };
  try {
    fchmodSync(openedFile.fd, FILE_MODE);
    return {
      exists: true,
      contents: readFileSync(openedFile.fd, "utf8"),
      identity: openedFile.identity,
    };
  } finally {
    closeSync(openedFile.fd);
  }
}
function cleanupTemporaryFile(request, name, expectedIdentity) {
  if (expectedIdentity === undefined) return;
  try {
    inspectDirectory(request);
    const current = lstatOptional(name);
    if (
      current !== undefined &&
      current.isFile() &&
      sameFile(identity(current), expectedIdentity)
    ) {
      unlinkSync(name);
    }
  } catch {
    // Preserve the original failure without unlinking an unverified entry.
  }
}
function writeSecretFile(request, directoryFd) {
  const initialFile = inspectSecretFile(
    request,
    request.expectedFileIdentity,
  );
  if (initialFile !== undefined) {
    try {
      fchmodSync(initialFile.fd, FILE_MODE);
    } finally {
      closeSync(initialFile.fd);
    }
  }
  inspectDirectory(request);
  fchmodSync(directoryFd, DIRECTORY_MODE);

  const temporaryName =
    "." + request.filename + "." + process.pid + "." + randomUUID() + ".tmp";
  let temporaryFd;
  let temporaryIdentity;
  let renamed = false;
  try {
    inspectDirectory(request);
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
      refuse("temporary secret file is not a private regular file");
    }
    temporaryIdentity = identity(temporaryStats);
    verifyContainedFile(request, temporaryName, temporaryIdentity);
    fchmodSync(temporaryFd, FILE_MODE);
    writeFileSync(temporaryFd, request.contents, "utf8");
    fsyncSync(temporaryFd);

    inspectDirectory(request);
    const currentFile = inspectSecretFile(
      request,
      request.expectedFileIdentity,
    );
    if (currentFile !== undefined) closeSync(currentFile.fd);
    inspectDirectory(request);
    renameSync(temporaryName, request.filename);
    renamed = true;

    const installedStats = lstatSync(request.filename);
    if (
      !installedStats.isFile() ||
      installedStats.nlink !== 1 ||
      !sameFile(identity(installedStats), temporaryIdentity)
    ) {
      refuse("installed secret file is not the private temporary file");
    }
    verifyContainedFile(request, request.filename, temporaryIdentity);
    fsyncSync(directoryFd);
    return temporaryIdentity;
  } finally {
    if (temporaryFd !== undefined) closeSync(temporaryFd);
    if (!renamed) cleanupTemporaryFile(request, temporaryName, temporaryIdentity);
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
    (request.operation !== "read" && request.operation !== "write") ||
    typeof request.directoryPath !== "string" ||
    typeof request.filename !== "string" ||
    !/^[^/\\\\]+$/.test(request.filename) ||
    request.filename === "." ||
    request.filename === ".."
  ) {
    refuse("filesystem request is invalid");
  }
  validateIdentity(request.directoryIdentity, "directory identity");
  if (request.operation === "write") {
    if (request.expectedFileIdentity !== null) {
      validateIdentity(request.expectedFileIdentity, "expected file identity");
    }
    if (typeof request.contents !== "string") {
      refuse("secret file contents are invalid");
    }
  }
  const directoryFd = anchorDirectory(request);
  try {
    if (request.operation === "read") {
      respond({ ok: true, snapshot: readSecretFile(request, directoryFd) });
    } else {
      respond({
        ok: true,
        fileIdentity: writeSecretFile(request, directoryFd),
      });
    }
  } finally {
    closeSync(directoryFd);
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
