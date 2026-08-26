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

function inspectScopeRoot(request) {
  const pathStats = lstatSync(request.scopeRootPath);
  if (
    pathStats.isSymbolicLink() ||
    !pathStats.isDirectory() ||
    !sameFile(identity(pathStats), request.scopeRootIdentity) ||
    realpathSync.native(request.scopeRootPath) !== request.scopeRootPath
  ) {
    refuse("scope root changed during daemon state access");
  }
}

function anchorScopeRoot(request) {
  inspectScopeRoot(request);
  const fd = openSync(
    request.scopeRootPath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const openedStats = fstatSync(fd);
    if (
      !openedStats.isDirectory() ||
      !sameFile(identity(openedStats), request.scopeRootIdentity)
    ) {
      refuse("scope root changed while daemon state was opened");
    }
    process.chdir(request.scopeRootPath);
    if (!sameFile(identity(statSync(".")), request.scopeRootIdentity)) {
      refuse("scope root changed while daemon state was anchored");
    }
    inspectScopeRoot(request);
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function inspectStateDirectory(request) {
  inspectScopeRoot(request);
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
      !sameFile(identity(statSync("..")), request.scopeRootIdentity)
    ) {
      refuse("default daemon state directory changed while it was anchored");
    }
    inspectScopeRoot(request);
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function ensureStateDirectory(request) {
  inspectScopeRoot(request);
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
    inspectScopeRoot(request);
    return identity(openedStats);
  } finally {
    closeSync(fd);
  }
}
`;
