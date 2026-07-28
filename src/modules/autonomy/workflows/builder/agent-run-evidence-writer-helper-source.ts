import { EVIDENCE_FILESYSTEM_COMMON_SOURCE } from "./agent-run-evidence-filesystem-helper-source.js";
import { BUILDER_EVIDENCE_MAX_FILE_BYTES } from "./agent-run-evidence-manifest.js";

export const EVIDENCE_WRITER_HELPER_SOURCE = `
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

${EVIDENCE_FILESYSTEM_COMMON_SOURCE}

const FILE_MODE = 0o600;
const MAX_FILE_BYTES = ${BUILDER_EVIDENCE_MAX_FILE_BYTES};

function inspectCurrentChain(identities) {
  for (let depth = 0; depth < identities.length; depth += 1) {
    const path = depth === 0 ? "." : Array(depth).fill("..").join("/");
    const stats = statSync(path);
    const expected = identities[identities.length - 1 - depth];
    if (!stats.isDirectory() || !sameFile(stats, expected)) {
      refuse("Builder evidence destination directory changed during projection");
    }
  }
}

function enterDirectory(part, parentIdentity) {
  if (lstatOptional(part) === undefined) mkdirSync(part, { mode: 0o700 });
  const pathStats = lstatSync(part);
  if (pathStats.isSymbolicLink() || !pathStats.isDirectory()) {
    refuse("Builder evidence projection path must be a real directory");
  }
  const fd = openSync(part, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (!opened.isDirectory() || !sameFile(opened, pathStats)) {
      refuse("Builder evidence destination directory changed during projection");
    }
    process.chdir(part);
    if (!sameFile(statSync("."), opened) || !sameFile(statSync(".."), parentIdentity)) {
      refuse("Builder evidence destination directory changed during projection");
    }
    return identity(opened);
  } finally {
    closeSync(fd);
  }
}

function inspectDestination(fileName, expectedIdentity) {
  const stats = lstatOptional(fileName);
  if (stats === undefined) {
    if (expectedIdentity !== null) {
      refuse("Builder evidence destination changed during projection");
    }
    return;
  }
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1) {
    refuse("Builder evidence destination must be a private regular file");
  }
  if (expectedIdentity === null || !sameFile(stats, expectedIdentity)) {
    refuse("Builder evidence destination changed during projection");
  }
}

function cleanupTemporary(name, expectedIdentity) {
  if (expectedIdentity === undefined) return;
  try {
    const stats = lstatOptional(name);
    if (stats && stats.isFile() && sameFile(stats, expectedIdentity)) unlinkSync(name);
  } catch {
    // Preserve the original failure without unlinking an unverified entry.
  }
}

function project(request) {
  const content = Buffer.from(request.content, "base64");
  if (content.length > MAX_FILE_BYTES) {
    refuse("Builder evidence projection exceeds the per-file limit");
  }
  inspectWorkspace(request);
  const identities = [request.workspaceIdentity];
  for (const part of request.directoryParts) {
    inspectCurrentChain(identities);
    identities.push(enterDirectory(part, identities[identities.length - 1]));
    inspectWorkspace(request);
  }
  inspectCurrentChain(identities);
  inspectDestination(request.fileName, request.expectedDestinationIdentity);

  const directoryFd = openSync(".", constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const temporaryName = ".builder-evidence." + process.pid + "." + randomUUID() + ".tmp";
  let temporaryFd;
  let temporaryIdentity;
  let installed = false;
  try {
    if (!sameFile(fstatSync(directoryFd), identities[identities.length - 1])) {
      refuse("Builder evidence destination directory changed during projection");
    }
    temporaryFd = openSync(
      temporaryName,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      FILE_MODE,
    );
    const temporaryStats = fstatSync(temporaryFd);
    if (!temporaryStats.isFile() || temporaryStats.nlink !== 1) {
      refuse("Builder evidence temporary file is not a private regular file");
    }
    temporaryIdentity = identity(temporaryStats);
    fchmodSync(temporaryFd, FILE_MODE);
    writeFileSync(temporaryFd, content);
    fsyncSync(temporaryFd);

    inspectWorkspace(request);
    inspectCurrentChain(identities);
    inspectDestination(request.fileName, request.expectedDestinationIdentity);
    renameSync(temporaryName, request.fileName);
    installed = true;

    const installedStats = lstatSync(request.fileName);
    if (
      !installedStats.isFile() ||
      installedStats.nlink !== 1 ||
      !sameFile(installedStats, temporaryIdentity)
    ) {
      refuse("Builder evidence destination changed while it was installed");
    }
    const installedFd = openSync(
      request.fileName,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      if (!sameFile(fstatSync(installedFd), temporaryIdentity)) {
        refuse("Builder evidence destination changed while it was installed");
      }
    } finally {
      closeSync(installedFd);
    }
    inspectWorkspace(request);
    inspectCurrentChain(identities);
    fsyncSync(directoryFd);
  } finally {
    if (temporaryFd !== undefined) closeSync(temporaryFd);
    if (!installed) cleanupTemporary(temporaryName, temporaryIdentity);
    closeSync(directoryFd);
  }
}

try {
  requireNoFollowPrimitives();
  const request = JSON.parse(readFileSync(0, "utf8"));
  if (
    request === null ||
    typeof request !== "object" ||
    typeof request.workspacePath !== "string" ||
    typeof request.workspaceRealPath !== "string" ||
    !Array.isArray(request.directoryParts) ||
    request.directoryParts.some((part) =>
      typeof part !== "string" ||
      !part ||
      part === "." ||
      part === ".." ||
      part.includes("/") ||
      part.includes("\\\\")
    ) ||
    typeof request.fileName !== "string" ||
    !request.fileName ||
    request.fileName === "." ||
    request.fileName === ".." ||
    request.fileName.includes("/") ||
    request.fileName.includes("\\\\") ||
    typeof request.content !== "string"
  ) {
    refuse("Builder evidence projection request is invalid");
  }
  validateIdentity(request.workspaceIdentity, "workspace identity");
  if (request.expectedDestinationIdentity !== null) {
    validateIdentity(request.expectedDestinationIdentity, "destination identity");
  }
  project(request);
  respond({ ok: true });
} catch (error) {
  const reason = error && typeof error.safeReason === "string"
    ? error.safeReason
    : "Builder evidence filesystem operation failed (" +
      (error && typeof error.code === "string" ? error.code : "unknown") + ")";
  respond({ ok: false, reason });
}
`;
