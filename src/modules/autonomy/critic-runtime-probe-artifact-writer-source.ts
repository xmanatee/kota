/*
 * Node does not expose openat(2)/renameat(2). The helper starts inside the
 * captured run directory, verifies "." against its expected inode, and uses
 * relative paths so a raced parent pathname cannot redirect any mutation.
 */
export const RUNTIME_PROBE_ARTIFACT_WRITER_SOURCE = `
import {
  closeSync,
  constants,
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

const ARTIFACT_NAME = "runtime-probe.json";
const FILE_MODE = 0o600;

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function identity(stats) {
  return { dev: stats.dev, ino: stats.ino };
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

function inspectRunDirectory(request) {
  const pathStats = lstatSync(request.runDirectoryPath);
  if (pathStats.isSymbolicLink()) {
    refuse("Runtime Probe run directory must not be a symbolic link");
  }
  if (
    !pathStats.isDirectory() ||
    !sameFile(pathStats, request.runDirectoryIdentity)
  ) {
    refuse("Runtime Probe run directory changed during the artifact write");
  }
  if (realpathSync.native(request.runDirectoryPath) !== request.runDirectoryPath) {
    refuse("Runtime Probe run directory changed during the artifact write");
  }
  const cwdStats = statSync(".");
  if (
    !cwdStats.isDirectory() ||
    !sameFile(cwdStats, request.runDirectoryIdentity)
  ) {
    refuse("Runtime Probe run directory changed during the artifact write");
  }
}

function inspectArtifact(expectedIdentity) {
  const stats = lstatOptional(ARTIFACT_NAME);
  if (stats === undefined) {
    if (expectedIdentity !== null) {
      refuse("Runtime Probe artifact changed during the artifact write");
    }
    return;
  }
  if (stats.isSymbolicLink()) {
    refuse("Runtime Probe artifact must not be a symbolic link");
  }
  if (!stats.isFile()) {
    refuse("Runtime Probe artifact must be a regular file");
  }
  if (stats.nlink !== 1) {
    refuse("Runtime Probe artifact must not have multiple hard links");
  }
  if (expectedIdentity === null || !sameFile(stats, expectedIdentity)) {
    refuse("Runtime Probe artifact changed during the artifact write");
  }
}

function cleanupTemporaryFile(name, expectedIdentity) {
  if (expectedIdentity === undefined) return;
  try {
    const stats = lstatOptional(name);
    if (
      stats !== undefined &&
      stats.isFile() &&
      sameFile(stats, expectedIdentity)
    ) {
      unlinkSync(name);
    }
  } catch {
    // Preserve the original refusal without unlinking an unverified entry.
  }
}

function writeArtifact(request) {
  inspectRunDirectory(request);
  inspectArtifact(request.expectedArtifactIdentity);

  if (
    !Number.isInteger(constants.O_DIRECTORY) ||
    constants.O_DIRECTORY === 0 ||
    !Number.isInteger(constants.O_NOFOLLOW) ||
    constants.O_NOFOLLOW === 0
  ) {
    refuse("Runtime Probe artifact writes require directory and no-follow open support");
  }

  const directoryFd = openSync(
    ".",
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  let temporaryFd;
  let temporaryIdentity;
  let installed = false;
  const temporaryName =
    ".runtime-probe." + process.pid + "." + randomUUID() + ".tmp";

  try {
    const directoryStats = fstatSync(directoryFd);
    if (
      !directoryStats.isDirectory() ||
      !sameFile(directoryStats, request.runDirectoryIdentity)
    ) {
      refuse("Runtime Probe run directory changed during the artifact write");
    }

    inspectRunDirectory(request);
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
      refuse("Runtime Probe temporary artifact is not a private regular file");
    }
    temporaryIdentity = identity(temporaryStats);
    writeFileSync(temporaryFd, request.serializedArtifact, "utf8");
    fsyncSync(temporaryFd);

    inspectRunDirectory(request);
    inspectArtifact(request.expectedArtifactIdentity);
    renameSync(temporaryName, ARTIFACT_NAME);
    installed = true;

    const installedStats = lstatSync(ARTIFACT_NAME);
    if (
      !installedStats.isFile() ||
      installedStats.nlink !== 1 ||
      !sameFile(installedStats, temporaryIdentity)
    ) {
      refuse("Runtime Probe artifact changed while it was being installed");
    }
    inspectRunDirectory(request);
    fsyncSync(directoryFd);
  } finally {
    if (temporaryFd !== undefined) closeSync(temporaryFd);
    if (!installed) cleanupTemporaryFile(temporaryName, temporaryIdentity);
    closeSync(directoryFd);
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
    typeof request.runDirectoryPath !== "string" ||
    typeof request.serializedArtifact !== "string"
  ) {
    refuse("Runtime Probe artifact request is invalid");
  }
  validateIdentity(request.runDirectoryIdentity, "run directory identity");
  if (request.expectedArtifactIdentity !== null) {
    validateIdentity(request.expectedArtifactIdentity, "artifact identity");
  }
  writeArtifact(request);
  respond({ ok: true });
} catch (error) {
  const reason =
    error && typeof error.safeReason === "string"
      ? error.safeReason
      : "Runtime Probe artifact filesystem operation failed (" +
        (error && typeof error.code === "string" ? error.code : "unknown") +
        ")";
  respond({ ok: false, reason });
}
`;
