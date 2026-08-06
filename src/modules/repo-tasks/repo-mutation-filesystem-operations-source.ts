export const REPO_MUTATION_FILESYSTEM_OPERATIONS_SOURCE = `
function readMarkdown(request, parentIdentity) {
  inspectAnchoredParent(request, parentIdentity);
  const opened = inspectMarkdownEntry(request.fileName, undefined);
  if (opened === undefined) return { exists: false };
  try {
    const content = readFileSync(opened.fd, "utf8");
    const after = snapshot(fstatSync(opened.fd));
    if (!sameSnapshot(after, opened.snapshot)) {
      refuse("markdown entry changed while it was read");
    }
    inspectAnchoredParent(request, parentIdentity);
    return { exists: true, content, snapshot: after };
  } finally {
    closeSync(opened.fd);
  }
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

function writeMarkdown(request, parentIdentity, directoryFd) {
  const expected =
    request.expectation === "existing" ? request.expectedSnapshot : undefined;
  const initial = inspectMarkdownEntry(request.fileName, expected);
  if (request.expectation === "missing" && initial !== undefined) {
    closeSync(initial.fd);
    refuse("repo mutation destination already exists");
  }
  if (request.expectation === "existing" && initial === undefined) {
    refuse("markdown entry changed during the repo mutation");
  }
  const initialSnapshot = initial && initial.snapshot;
  const initialMode = initial && initial.mode;
  if (initial !== undefined) closeSync(initial.fd);

  const temporaryName =
    ".repo-mutation." + process.pid + "." + randomUUID() + ".tmp";
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
      refuse("temporary repo mutation file is not private");
    }
    temporaryIdentity = identity(temporaryStats);
    if (initialMode !== undefined) fchmodSync(temporaryFd, initialMode);
    writeFileSync(temporaryFd, request.content, "utf8");
    fsyncSync(temporaryFd);

    inspectAnchoredParent(request, parentIdentity);
    const current = inspectMarkdownEntry(request.fileName, initialSnapshot);
    if (current !== undefined) closeSync(current.fd);
    if (initialSnapshot === undefined) {
      try {
        linkSync(temporaryName, request.fileName);
      } catch (error) {
        if (error && error.code === "EEXIST") {
          refuse("repo mutation destination changed before installation");
        }
        throw error;
      }
      unlinkSync(temporaryName);
    } else {
      renameSync(temporaryName, request.fileName);
    }
    installed = true;

    const installedEntry = inspectMarkdownEntry(request.fileName, undefined);
    if (
      installedEntry === undefined ||
      !sameIdentity(installedEntry.snapshot, temporaryIdentity)
    ) {
      if (installedEntry !== undefined) closeSync(installedEntry.fd);
      refuse("installed markdown entry is not the private temporary file");
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

function removeMarkdown(request, parentIdentity, directoryFd) {
  const opened = inspectMarkdownEntry(request.fileName, request.expectedSnapshot);
  if (opened === undefined) {
    refuse("repo mutation source does not exist");
  }
  closeSync(opened.fd);
  inspectAnchoredParent(request, parentIdentity);

  const quarantineName =
    ".repo-mutation." + process.pid + "." + randomUUID() + ".removed";
  let quarantined = false;
  try {
    renameSync(request.fileName, quarantineName);
    quarantined = true;
    const moved = inspectMarkdownEntry(quarantineName, undefined);
    if (moved === undefined) {
      refuse("markdown entry changed during removal");
    }
    if (
      !sameIdentity(moved.snapshot, request.expectedSnapshot) ||
      moved.snapshot.size !== request.expectedSnapshot.size ||
      moved.snapshot.mtimeMs !== request.expectedSnapshot.mtimeMs
    ) {
      closeSync(moved.fd);
      refuse("markdown entry changed during removal");
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
