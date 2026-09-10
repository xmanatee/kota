export const ANCHORED_FILE_COMMON_SOURCE = `
function identity(stats) {
  return { dev: stats.dev, ino: stats.ino };
}

function snapshot(stats) {
  return {
    ...identity(stats),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    ctimeMs: stats.ctimeMs,
  };
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameSnapshot(left, right) {
  return (
    sameIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
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

function validateSnapshot(value, field) {
  validateIdentity(value, field);
  if (
    !Number.isSafeInteger(value.size) ||
    value.size < 0 ||
    !Number.isFinite(value.mtimeMs) ||
    !Number.isFinite(value.ctimeMs)
  ) {
    refuse(field + " is invalid");
  }
}

function requireNoFollowPrimitives() {
  if (
    !Number.isInteger(constants.O_DIRECTORY) ||
    constants.O_DIRECTORY === 0 ||
    !Number.isInteger(constants.O_NOFOLLOW) ||
    constants.O_NOFOLLOW === 0
  ) {
    refuse("filesystem operations require directory and no-follow open support");
  }
}

function inspectRoot(request) {
  const stats = lstatSync(request.rootPath);
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    !sameIdentity(stats, request.rootIdentity) ||
    realpathSync.native(request.rootPath) !== request.rootPath
  ) {
    refuse("filesystem root changed during filesystem access");
  }
}

function inspectAnchoredParent(request, expectedIdentity) {
  inspectRoot(request);
  const anchored = statSync(".");
  if (!anchored.isDirectory() || !sameIdentity(anchored, expectedIdentity)) {
    refuse("parent directory changed during filesystem access");
  }
  const pathStats = lstatSync(request.parentPath);
  if (
    pathStats.isSymbolicLink() ||
    !pathStats.isDirectory() ||
    !sameIdentity(pathStats, expectedIdentity) ||
    realpathSync.native(request.parentPath) !== request.parentPath
  ) {
    refuse("parent directory changed during filesystem access");
  }
}

function enterParent(request) {
  inspectRoot(request);
  const rootFd = openSync(
    request.rootPath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const rootStats = fstatSync(rootFd);
    if (
      !rootStats.isDirectory() ||
      !sameIdentity(rootStats, request.rootIdentity)
    ) {
      refuse("filesystem root changed while it was opened");
    }
    process.chdir(request.rootPath);
    if (!sameIdentity(statSync("."), request.rootIdentity)) {
      refuse("filesystem root changed while it was anchored");
    }
    inspectRoot(request);

    let currentIdentity = request.rootIdentity;
    for (const part of request.parentParts) {
      let pathStats = lstatOptional(part);
      if (pathStats === undefined) {
        if (!request.createParent) return undefined;
        mkdirSync(part);
        pathStats = lstatSync(part);
      }
      if (pathStats.isSymbolicLink()) {
        refuse("symbolic-link directory components are forbidden");
      }
      if (!pathStats.isDirectory()) {
        refuse("parent components must be real directories");
      }
      const directoryFd = openSync(
        part,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      try {
        const opened = fstatSync(directoryFd);
        if (!opened.isDirectory() || !sameIdentity(opened, pathStats)) {
          refuse("parent directory changed while it was opened");
        }
        process.chdir(part);
        if (
          !sameIdentity(statSync("."), opened) ||
          !sameIdentity(statSync(".."), currentIdentity)
        ) {
          refuse("parent directory changed while it was anchored");
        }
        currentIdentity = identity(opened);
      } finally {
        closeSync(directoryFd);
      }
      inspectRoot(request);
    }
    inspectAnchoredParent(request, currentIdentity);
    return currentIdentity;
  } finally {
    closeSync(rootFd);
  }
}

function inspectTextFileEntry(name, expectedSnapshot) {
  const pathStats = lstatOptional(name);
  if (pathStats === undefined) {
    if (expectedSnapshot !== undefined) {
      refuse("file entry changed during filesystem access");
    }
    return undefined;
  }
  if (pathStats.isSymbolicLink()) {
    refuse("symbolic-link file entries are forbidden");
  }
  if (!pathStats.isFile()) {
    refuse("file entries must be regular files");
  }
  if (pathStats.nlink !== 1) {
    refuse("file entries must not have multiple hard links");
  }
  const fd = openSync(
    name,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const opened = fstatSync(fd);
    const openedSnapshot = snapshot(opened);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      !sameSnapshot(openedSnapshot, snapshot(pathStats)) ||
      (expectedSnapshot !== undefined &&
        !sameSnapshot(openedSnapshot, expectedSnapshot))
    ) {
      refuse("file entry changed during filesystem access");
    }
    return { fd, mode: opened.mode & 0o777, snapshot: openedSnapshot };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}
`;
