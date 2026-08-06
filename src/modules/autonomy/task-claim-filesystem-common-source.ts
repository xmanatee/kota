/* Shared directory-anchor primitives for the isolated task-claim helper. */
export const TASK_CLAIM_FILESYSTEM_COMMON_SOURCE = `
import { randomUUID } from "node:crypto";
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
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  linkSync,
} from "node:fs";
import { join } from "node:path";

const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const MAX_CLAIM_BYTES = 1024 * 1024;
let currentRequest;
const canonicalParts = [];

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function identity(stats) {
  return { dev: Number(stats.dev), ino: Number(stats.ino) };
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

function requireNoFollowPrimitives() {
  if (
    !Number.isInteger(constants.O_DIRECTORY) ||
    constants.O_DIRECTORY === 0 ||
    !Number.isInteger(constants.O_NOFOLLOW) ||
    constants.O_NOFOLLOW === 0
  ) {
    refuse("task claim storage requires directory and no-follow open support");
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

function validateSegment(value, field) {
  if (
    typeof value !== "string" ||
    !value ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\\\")
  ) {
    refuse(field + " is invalid");
  }
}

function safeTaskClaimSegment(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

function inspectProject(request) {
  const pathStats = lstatSync(request.projectPath);
  if (
    pathStats.isSymbolicLink() ||
    !pathStats.isDirectory() ||
    !sameFile(pathStats, request.projectIdentity) ||
    realpathSync.native(request.projectPath) !== request.projectRealPath
  ) {
    refuse("project directory changed during task claim filesystem access");
  }
  const cwdStats = statSync(".");
  if (!cwdStats.isDirectory() || !sameFile(cwdStats, request.projectIdentity)) {
    refuse("task claim helper is not anchored in the verified project directory");
  }
}

function inspectChain(identities) {
  for (let depth = 0; depth < identities.length; depth += 1) {
    const path = depth === 0 ? "." : Array(depth).fill("..").join("/");
    const stats = statSync(path);
    const expected = identities[identities.length - 1 - depth];
    if (!stats.isDirectory() || !sameFile(stats, expected)) {
      refuse("task claim directory chain changed during filesystem access");
    }
  }
  let canonicalPath = currentRequest.projectPath;
  for (let depth = 0; depth < canonicalParts.length; depth += 1) {
    canonicalPath = join(canonicalPath, canonicalParts[depth]);
    const stats = lstatOptional(canonicalPath);
    const expected = identities[depth + 1];
    if (
      stats === undefined ||
      stats.isSymbolicLink() ||
      !stats.isDirectory() ||
      !sameFile(stats, expected)
    ) {
      refuse("canonical task claim directory changed during filesystem access");
    }
  }
}

function enterDirectory(part, identities, create) {
  let pathStats = lstatOptional(part);
  if (pathStats === undefined) {
    if (!create) return false;
    try {
      mkdirSync(part, { mode: DIRECTORY_MODE });
    } catch (error) {
      if (!error || error.code !== "EEXIST") throw error;
    }
    pathStats = lstatSync(part);
  }
  if (pathStats.isSymbolicLink() || !pathStats.isDirectory()) {
    refuse("task claim storage components must be real directories");
  }
  const fd = openSync(
    part,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const opened = fstatSync(fd);
    if (!opened.isDirectory() || !sameFile(opened, pathStats)) {
      refuse("task claim directory changed while it was opened");
    }
    process.chdir(part);
    const parent = identities[identities.length - 1];
    if (!sameFile(statSync("."), opened) || !sameFile(statSync(".."), parent)) {
      refuse("task claim directory changed while it was entered");
    }
    identities.push(identity(opened));
    canonicalParts.push(part);
    inspectChain(identities);
    return true;
  } finally {
    closeSync(fd);
  }
}

function leaveToDepth(identities, targetDepth) {
  while (identities.length > targetDepth) {
    process.chdir("..");
    identities.pop();
    canonicalParts.pop();
    const expected = identities[identities.length - 1];
    if (!sameFile(statSync("."), expected)) {
      refuse("task claim directory changed while leaving a storage component");
    }
  }
  inspectChain(identities);
}

function enterClaimsRoot(request, create) {
  inspectProject(request);
  const identities = [request.projectIdentity];
  if (!enterDirectory(".kota", identities, create)) return null;
  if (!enterDirectory("task-claims", identities, create)) return null;
  return identities;
}
`;
