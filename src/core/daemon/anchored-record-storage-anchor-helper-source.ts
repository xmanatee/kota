export const ANCHORED_RECORD_STORAGE_ANCHOR_HELPER_SOURCE = `
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
  for (const anchor of request.directoryAnchors) {
    const stats = lstatSync(anchor.path);
    if (!stats.isDirectory() || !sameFile(identity(stats), anchor.identity)) {
      refuse("record directory ancestor changed during access");
    }
  }
  const pathStats = lstatSync(request.directoryPath);
  if (pathStats.isSymbolicLink()) {
    refuse("record directory must not be a symbolic link");
  }
  if (!pathStats.isDirectory()) {
    refuse("record directory must be a directory");
  }
  requireDaemonOwner(pathStats, "record directory");
  if (
    !sameFile(identity(pathStats), request.directoryIdentity) ||
    realpathSync.native(request.directoryPath) !== request.directoryPath
  ) {
    refuse("record directory changed during access");
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
    requireDaemonOwner(openedStats, "record directory");
    if (
      !openedStats.isDirectory() ||
      !sameFile(identity(openedStats), request.directoryIdentity)
    ) {
      refuse("record directory changed while it was opened");
    }
    process.chdir(request.directoryPath);
    if (!sameFile(identity(statSync(".")), request.directoryIdentity)) {
      refuse("record directory changed while it was anchored");
    }
    inspectDirectory(request);
    fchmodSync(fd, DIRECTORY_MODE);
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}
`;
