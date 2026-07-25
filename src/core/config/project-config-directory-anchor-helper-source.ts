export const DIRECTORY_ANCHOR_HELPER_SOURCE = `
function inspectProjectRoot(request) {
  const pathStats = lstatSync(request.projectRootPath);
  if (pathStats.isSymbolicLink()) {
    refuse("project root must not be a symbolic link");
  }
  if (!pathStats.isDirectory()) {
    refuse("project root must be a directory");
  }
  if (!sameFile(pathStats, request.projectRootIdentity)) {
    refuse("project root changed during the update");
  }
  if (realpathSync.native(request.projectRootPath) !== request.projectRootPath) {
    refuse("project root changed during the update");
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
      !sameFile(openedStats, request.projectRootIdentity)
    ) {
      refuse("project root changed during the update");
    }

    process.chdir(request.projectRootPath);
    const anchoredStats = statSync(".");
    if (
      !anchoredStats.isDirectory() ||
      !sameFile(anchoredStats, request.projectRootIdentity)
    ) {
      refuse("project root changed during the update");
    }
    inspectProjectRoot(request);
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function anchorConfigDirectory(request) {
  inspectProjectRoot(request);
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
    const anchoredProjectStats = statSync("..");
    if (!sameFile(anchoredProjectStats, request.projectRootIdentity)) {
      refuse("project root changed during the update");
    }
    inspectProjectRoot(request);
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function ensureConfigDirectory(request) {
  inspectProjectRoot(request);
  if (lstatOptional(CONFIG_DIRECTORY) === undefined) {
    mkdirSync(CONFIG_DIRECTORY, { mode: DIRECTORY_MODE });
  }

  inspectProjectRoot(request);
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
    inspectProjectRoot(request);
    return identity(openedStats);
  } finally {
    closeSync(directoryFd);
  }
}
`;
