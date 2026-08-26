export const DIRECTORY_ANCHOR_HELPER_SOURCE = `
function inspectScopeRoot(request) {
  const pathStats = lstatSync(request.scopeRootPath);
  if (pathStats.isSymbolicLink()) {
    refuse("scope root must not be a symbolic link");
  }
  if (!pathStats.isDirectory()) {
    refuse("scope root must be a directory");
  }
  if (!sameFile(pathStats, request.scopeRootIdentity)) {
    refuse("scope root changed during the update");
  }
  if (realpathSync.native(request.scopeRootPath) !== request.scopeRootPath) {
    refuse("scope root changed during the update");
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
      !sameFile(openedStats, request.scopeRootIdentity)
    ) {
      refuse("scope root changed during the update");
    }

    process.chdir(request.scopeRootPath);
    const anchoredStats = statSync(".");
    if (
      !anchoredStats.isDirectory() ||
      !sameFile(anchoredStats, request.scopeRootIdentity)
    ) {
      refuse("scope root changed during the update");
    }
    inspectScopeRoot(request);
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function anchorConfigDirectory(request) {
  inspectScopeRoot(request);
  const pathStats = lstatSync(CONFIG_DIRECTORY);
  if (pathStats.isSymbolicLink()) {
    refuse("config directory must not be a symbolic link");
  }
  if (!pathStats.isDirectory()) {
    refuse("config directory must be a directory");
  }
  if (!sameFile(pathStats, request.directoryIdentity)) {
    refuse("config directory changed during the update");
  }

  const fd = openSync(
    CONFIG_DIRECTORY,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const openedStats = fstatSync(fd);
    if (
      !openedStats.isDirectory() ||
      !sameFile(openedStats, request.directoryIdentity)
    ) {
      refuse("config directory changed during the update");
    }

    process.chdir(CONFIG_DIRECTORY);
    const anchoredStats = statSync(".");
    if (
      !anchoredStats.isDirectory() ||
      !sameFile(anchoredStats, request.directoryIdentity)
    ) {
      refuse("config directory changed during the update");
    }
    const anchoredScopeStats = statSync("..");
    if (!sameFile(anchoredScopeStats, request.scopeRootIdentity)) {
      refuse("scope root changed during the update");
    }
    inspectScopeRoot(request);
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function ensureConfigDirectory(request) {
  inspectScopeRoot(request);
  if (lstatOptional(CONFIG_DIRECTORY) === undefined) {
    mkdirSync(CONFIG_DIRECTORY, { mode: DIRECTORY_MODE });
  }

  inspectScopeRoot(request);
  const pathStats = lstatSync(CONFIG_DIRECTORY);
  if (pathStats.isSymbolicLink()) {
    refuse("config directory must not be a symbolic link");
  }
  if (!pathStats.isDirectory()) {
    refuse("config directory must be a directory");
  }

  const directoryFd = openSync(
    CONFIG_DIRECTORY,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const openedStats = fstatSync(directoryFd);
    if (
      !openedStats.isDirectory() ||
      !sameFile(openedStats, identity(pathStats))
    ) {
      refuse("config directory changed during the update");
    }
    inspectScopeRoot(request);
    return identity(openedStats);
  } finally {
    closeSync(directoryFd);
  }
}
`;
