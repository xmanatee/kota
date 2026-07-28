export const DAEMON_STATE_ROOT_ANCHOR_HELPER_SOURCE = `
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

function inspectProjectRoot(request) {
  const pathStats = lstatSync(request.projectRootPath);
  if (
    pathStats.isSymbolicLink() ||
    !pathStats.isDirectory() ||
    !sameFile(identity(pathStats), request.projectRootIdentity) ||
    realpathSync.native(request.projectRootPath) !== request.projectRootPath
  ) {
    refuse("project root changed during daemon state access");
  }
}

function anchorProjectRoot(request) {
  inspectProjectRoot(request);
  const fd = openSync(
    request.projectRootPath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const openedStats = fstatSync(fd);
    if (
      !openedStats.isDirectory() ||
      !sameFile(identity(openedStats), request.projectRootIdentity)
    ) {
      refuse("project root changed while daemon state was opened");
    }
    process.chdir(request.projectRootPath);
    if (!sameFile(identity(statSync(".")), request.projectRootIdentity)) {
      refuse("project root changed while daemon state was anchored");
    }
    inspectProjectRoot(request);
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function inspectStateDirectory(request) {
  inspectProjectRoot(request);
  const pathStats = lstatSync(STATE_DIRECTORY);
  if (pathStats.isSymbolicLink()) {
    refuse("default daemon state directory must not be a symbolic link");
  }
  if (
    !pathStats.isDirectory() ||
    !sameFile(identity(pathStats), request.directoryIdentity)
  ) {
    refuse("default daemon state directory changed during access");
  }
}

function anchorStateDirectory(request) {
  inspectStateDirectory(request);
  const fd = openSync(
    STATE_DIRECTORY,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const openedStats = fstatSync(fd);
    if (
      !openedStats.isDirectory() ||
      !sameFile(identity(openedStats), request.directoryIdentity)
    ) {
      refuse("default daemon state directory changed while it was opened");
    }
    process.chdir(STATE_DIRECTORY);
    if (
      !sameFile(identity(statSync(".")), request.directoryIdentity) ||
      !sameFile(identity(statSync("..")), request.projectRootIdentity)
    ) {
      refuse("default daemon state directory changed while it was anchored");
    }
    inspectProjectRoot(request);
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function ensureStateDirectory(request) {
  inspectProjectRoot(request);
  if (lstatOptional(STATE_DIRECTORY) === undefined) {
    mkdirSync(STATE_DIRECTORY, { mode: DIRECTORY_MODE });
  }
  const pathStats = lstatSync(STATE_DIRECTORY);
  if (pathStats.isSymbolicLink()) {
    refuse("default daemon state directory must not be a symbolic link");
  }
  if (!pathStats.isDirectory()) {
    refuse("default daemon state directory must be a directory");
  }
  const fd = openSync(
    STATE_DIRECTORY,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const openedStats = fstatSync(fd);
    if (
      !openedStats.isDirectory() ||
      !sameFile(identity(openedStats), identity(pathStats))
    ) {
      refuse("default daemon state directory changed while it was opened");
    }
    fchmodSync(fd, DIRECTORY_MODE);
    inspectProjectRoot(request);
    return identity(openedStats);
  } finally {
    closeSync(fd);
  }
}
`;
