export const ANCHORED_FILE_OPERATIONS_SOURCE = `
function listDirectoryEntries(request, parentIdentity) {
  inspectAnchoredParent(request, parentIdentity);
  const entries = directoryNames().sort().map(name => {
    const stats = lstatSync(name);
    if (stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory()) || (stats.isFile() && stats.nlink !== 1)) {
      refuse("directory entries must be real directories or single-link regular files");
    }
    return { name, kind: stats.isDirectory() ? "directory" : "file" };
  });
  inspectAnchoredParent(request, parentIdentity);
  return entries;
}

function listTextFiles(request, parentIdentity) {
  inspectAnchoredParent(request, parentIdentity);
  const names = directoryNames()
    .filter((name) => request.nameSuffix === null || name.endsWith(request.nameSuffix))
    .sort();
  const entries = [];
  for (const name of names) {
    const snapshot = readTextFile(
      { ...request, fileName: name },
      parentIdentity,
    );
    if (!snapshot.exists) {
      refuse("file entry disappeared during directory discovery");
    }
    entries.push({ name, content: snapshot.content, snapshot: snapshot.snapshot });
  }
  inspectAnchoredParent(request, parentIdentity);
  return entries;
}

function readTextFile(request, parentIdentity) {
  inspectAnchoredParent(request, parentIdentity);
  const opened = inspectTextFileEntry(request.fileName, undefined);
  if (opened === undefined) return { exists: false };
  try {
    let content;
    if (request.maxBytes !== undefined) {
      if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes < 0 || opened.snapshot.size > request.maxBytes) {
        refuse("file exceeds read limit");
      }
      const bytes = Buffer.alloc(request.maxBytes + 1);
      let length = 0;
      while (length < bytes.length) {
        const count = readSync(opened.fd, bytes, length, bytes.length - length, length);
        if (count === 0) break;
        length += count;
      }
      if (length > request.maxBytes) refuse("file exceeds read limit");
      content = bytes.subarray(0, length).toString("utf8");
    } else {
      content = readFileSync(opened.fd, "utf8");
    }
    const after = snapshot(fstatSync(opened.fd));
    if (!sameSnapshot(after, opened.snapshot)) {
      refuse("file entry changed while it was read");
    }
    inspectAnchoredParent(request, parentIdentity);
    return { exists: true, content, snapshot: after };
  } finally {
    closeSync(opened.fd);
  }
}

function appendTextFile(request, parentIdentity, directoryFd) {
  inspectAnchoredParent(request, parentIdentity);
  const initial = inspectTextFileEntry(request.fileName, undefined);
  const before = initial && initial.snapshot;
  if (initial) closeSync(initial.fd);
  const fd = openSync(request.fileName,
    constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK |
      (before === undefined ? constants.O_CREAT | constants.O_EXCL : 0), 0o666);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || (before && !sameIdentity(opened, before))) {
      refuse("file entry changed while opening for append");
    }
    inspectAnchoredParent(request, parentIdentity);
    writeFileSync(fd, request.content, "utf8");
    fsyncSync(fd);
    fsyncSync(directoryFd);
  } finally { closeSync(fd); }
}

function cleanupTemporary(name, expectedIdentity) {
  if (expectedIdentity === undefined) return;
  try {
    const current = lstatOptional(name);
    if (
      current !== undefined &&
      current.isFile() &&
      sameIdentity(current, expectedIdentity)
    ) {
      unlinkSync(name);
    }
  } catch {
    // Preserve the original failure without unlinking an unverified entry.
  }
}

function writeTextFile(request, parentIdentity, directoryFd) {
  const expected =
    request.expectation === "existing" ? request.expectedSnapshot : undefined;
  const initial = inspectTextFileEntry(request.fileName, expected);
  if (request.expectation === "missing" && initial !== undefined) {
    closeSync(initial.fd);
    refuse("file destination already exists");
  }
  if (request.expectation === "existing" && initial === undefined) {
    refuse("file entry changed during filesystem access");
  }
  const initialSnapshot = initial && initial.snapshot;
  const initialMode = initial && initial.mode;
  if (initial !== undefined) closeSync(initial.fd);

  const temporaryName =
    ".anchored-file." + process.pid + "." + randomUUID() + ".tmp";
  let temporaryFd;
  let temporaryIdentity;
  let installed = false;
  try {
    inspectAnchoredParent(request, parentIdentity);
    temporaryFd = openSync(
      temporaryName,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o666,
    );
    const temporaryStats = fstatSync(temporaryFd);
    if (!temporaryStats.isFile() || temporaryStats.nlink !== 1) {
      refuse("temporary file is not private");
    }
    temporaryIdentity = identity(temporaryStats);
    if (initialMode !== undefined) fchmodSync(temporaryFd, initialMode);
    writeFileSync(temporaryFd, request.content, "utf8");
    fsyncSync(temporaryFd);

    inspectAnchoredParent(request, parentIdentity);
    const current = inspectTextFileEntry(request.fileName, initialSnapshot);
    if (current !== undefined) closeSync(current.fd);
    if (initialSnapshot === undefined) {
      try {
        linkSync(temporaryName, request.fileName);
      } catch (error) {
        if (error && error.code === "EEXIST") {
          refuse("file destination changed before installation");
        }
        throw error;
      }
      unlinkSync(temporaryName);
    } else {
      renameSync(temporaryName, request.fileName);
    }
    installed = true;

    const installedEntry = inspectTextFileEntry(request.fileName, undefined);
    if (
      installedEntry === undefined ||
      !sameIdentity(installedEntry.snapshot, temporaryIdentity)
    ) {
      if (installedEntry !== undefined) closeSync(installedEntry.fd);
      refuse("installed file entry is not the private temporary file");
    }
    const installedSnapshot = installedEntry.snapshot;
    closeSync(installedEntry.fd);
    fsyncSync(directoryFd);
    return installedSnapshot;
  } finally {
    if (temporaryFd !== undefined) closeSync(temporaryFd);
    if (!installed) cleanupTemporary(temporaryName, temporaryIdentity);
  }
}

function restoreQuarantinedEntry(name, quarantineName) {
  try {
    if (lstatOptional(name) === undefined) {
      linkSync(quarantineName, name);
      unlinkSync(quarantineName);
    }
  } catch {
    // Preserve the identity failure and leave the quarantined entry intact.
  }
}

function removeTextFile(request, parentIdentity, directoryFd) {
  const opened = inspectTextFileEntry(request.fileName, request.expectedSnapshot);
  if (opened === undefined) {
    refuse("file source does not exist");
  }
  closeSync(opened.fd);
  inspectAnchoredParent(request, parentIdentity);

  const quarantineName =
    ".anchored-file." + process.pid + "." + randomUUID() + ".removed";
  let quarantined = false;
  try {
    renameSync(request.fileName, quarantineName);
    quarantined = true;
    const moved = inspectTextFileEntry(quarantineName, undefined);
    if (moved === undefined) {
      refuse("file entry changed during removal");
    }
    if (
      !sameIdentity(moved.snapshot, request.expectedSnapshot) ||
      moved.snapshot.size !== request.expectedSnapshot.size ||
      moved.snapshot.mtimeMs !== request.expectedSnapshot.mtimeMs
    ) {
      closeSync(moved.fd);
      refuse("file entry changed during removal");
    }
    closeSync(moved.fd);
    unlinkSync(quarantineName);
    quarantined = false;
    fsyncSync(directoryFd);
  } catch (error) {
    if (quarantined) restoreQuarantinedEntry(request.fileName, quarantineName);
    throw error;
  }
}
`;
