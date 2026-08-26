export const REPO_MUTATION_FILESYSTEM_COMMON_SOURCE = `
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
    refuse("repo mutations require directory and no-follow open support");
  }
}

function inspectRepoRoot(request) {
  const stats = lstatSync(request.repoRootPath);
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    !sameIdentity(stats, request.repoRootIdentity) ||
    realpathSync.native(request.repoRootPath) !== request.repoRootPath
  ) {
    refuse("repository root changed during the repo mutation");
  }
}

function inspectAnchoredParent(request, expectedIdentity) {
  inspectRepoRoot(request);
  const anchored = statSync(".");
  if (!anchored.isDirectory() || !sameIdentity(anchored, expectedIdentity)) {
    refuse("parent directory changed during the repo mutation");
  }
  const pathStats = lstatSync(request.parentPath);
  if (
    pathStats.isSymbolicLink() ||
    !pathStats.isDirectory() ||
    !sameIdentity(pathStats, expectedIdentity) ||
    realpathSync.native(request.parentPath) !== request.parentPath
  ) {
    refuse("parent directory changed during the repo mutation");
  }
}

function enterParent(request) {
  inspectRepoRoot(request);
  const projectFd = openSync(
    request.repoRootPath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const repoStats = fstatSync(projectFd);
    if (
      !repoStats.isDirectory() ||
      !sameIdentity(repoStats, request.repoRootIdentity)
    ) {
      refuse("repository root changed while it was opened");
    }
    process.chdir(request.repoRootPath);
    if (!sameIdentity(statSync("."), request.repoRootIdentity)) {
      refuse("repository root changed while it was anchored");
    }
    inspectRepoRoot(request);

    let currentIdentity = request.repoRootIdentity;
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
      inspectRepoRoot(request);
    }
    inspectAnchoredParent(request, currentIdentity);
    return currentIdentity;
  } finally {
    closeSync(projectFd);
  }
}

function inspectMarkdownEntry(name, expectedSnapshot) {
  const pathStats = lstatOptional(name);
  if (pathStats === undefined) {
    if (expectedSnapshot !== undefined) {
      refuse("markdown entry changed during the repo mutation");
    }
    return undefined;
  }
  if (pathStats.isSymbolicLink()) {
    refuse("symbolic-link markdown entries are forbidden");
  }
  if (!pathStats.isFile()) {
    refuse("markdown entries must be regular files");
  }
  if (pathStats.nlink !== 1) {
    refuse("markdown entries must not have multiple hard links");
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
      refuse("markdown entry changed during the repo mutation");
    }
    return { fd, mode: opened.mode & 0o777, snapshot: openedSnapshot };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}
`;
