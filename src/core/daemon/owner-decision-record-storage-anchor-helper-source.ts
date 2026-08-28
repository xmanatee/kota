export const OWNER_DECISION_RECORD_STORAGE_ANCHOR_HELPER_SOURCE = `
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

function requireDaemonOwner(stats, label) {
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    refuse(label + " must be owned by the daemon user");
  }
}

function inspectDirectory(request) {
  const pathStats = lstatSync(request.directoryPath);
  if (pathStats.isSymbolicLink()) {
    refuse("owner decision directory must not be a symbolic link");
  }
  if (!pathStats.isDirectory()) {
    refuse("owner decision directory must be a directory");
  }
  requireDaemonOwner(pathStats, "owner decision directory");
  if (
    !sameFile(identity(pathStats), request.directoryIdentity) ||
    realpathSync.native(request.directoryPath) !== request.directoryPath
  ) {
    refuse("owner decision directory changed during access");
  }
}

function anchorDirectory(request) {
  inspectDirectory(request);
  process.chdir(request.directoryPath);
  const cwdStats = statSync(".");
  if (
    !sameFile(identity(cwdStats), request.directoryIdentity) ||
    !sameFile(identity(lstatSync(".")), request.directoryIdentity)
  ) {
    refuse("owner decision directory changed during access");
  }
  inspectDirectory(request);
}
`;
