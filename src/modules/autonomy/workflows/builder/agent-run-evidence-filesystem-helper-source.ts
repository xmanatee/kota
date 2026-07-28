/*
 * Node does not expose openat(2). Builder evidence helpers start in an
 * identity-checked directory and use relative paths so raced ancestors cannot
 * redirect file reads or projection writes.
 */
export const EVIDENCE_FILESYSTEM_COMMON_SOURCE = `
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
    refuse("Builder evidence projection requires directory and no-follow open support");
  }
}

function inspectWorkspace(request) {
  const stats = lstatSync(request.workspacePath);
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    !sameFile(stats, request.workspaceIdentity) ||
    realpathSync.native(request.workspacePath) !== request.workspaceRealPath
  ) {
    refuse("Builder workspace changed during evidence projection");
  }
}

function inspectAnchoredDirectory(request) {
  inspectWorkspace(request);
  const pathStats = lstatSync(request.directoryPath);
  if (
    pathStats.isSymbolicLink() ||
    !pathStats.isDirectory() ||
    !sameFile(pathStats, request.ancestorIdentities[0]) ||
    realpathSync.native(request.directoryPath) !== request.directoryRealPath
  ) {
    refuse("Builder evidence directory changed during projection");
  }
  for (let depth = 0; depth < request.ancestorIdentities.length; depth += 1) {
    const path = depth === 0 ? "." : Array(depth).fill("..").join("/");
    const stats = statSync(path);
    if (!stats.isDirectory() || !sameFile(stats, request.ancestorIdentities[depth])) {
      refuse("Builder evidence directory changed during projection");
    }
  }
}

function respond(response) {
  process.stdout.write(JSON.stringify(response));
}
`;
