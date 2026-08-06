/* Private regular-file primitives for the isolated task-claim helper. */
export const TASK_CLAIM_FILESYSTEM_FILE_SOURCE = `
function inspectPrivateFile(fileName) {
  const pathStats = lstatOptional(fileName);
  if (pathStats === undefined) return null;
  if (pathStats.isSymbolicLink() || !pathStats.isFile() || pathStats.nlink !== 1) {
    refuse("task claim entries must be private regular files");
  }
  const fd = openSync(
    fileName,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const opened = fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      !sameFile(opened, pathStats) ||
      opened.size > MAX_CLAIM_BYTES
    ) {
      refuse("task claim entry changed while it was opened");
    }
    return { content: readFileSync(fd, "utf8"), identity: identity(opened) };
  } finally {
    closeSync(fd);
  }
}

function validateStoredTaskId(content, taskId, fileName) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    refuse("task claim entry contains malformed JSON");
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    parsed.taskId !== taskId ||
    fileName !== safeTaskClaimSegment(taskId) + ".json"
  ) {
    refuse("stored task claim id does not match its requested filename");
  }
}

function cleanupTemporaryFile(name, expectedIdentity) {
  if (expectedIdentity === undefined) return;
  try {
    const stats = lstatOptional(name);
    if (stats && stats.isFile() && sameFile(stats, expectedIdentity)) unlinkSync(name);
  } catch {
    // Preserve the original failure without removing an unverified entry.
  }
}

function inspectExpectedDestination(fileName, expectedIdentity) {
  const current = lstatOptional(fileName);
  if (current === undefined) {
    if (expectedIdentity !== null) {
      refuse("task claim destination changed during write");
    }
    return;
  }
  if (current.isSymbolicLink() || !current.isFile() || current.nlink !== 1) {
    refuse("task claim entries must be private regular files");
  }
  if (expectedIdentity === null || !sameFile(current, expectedIdentity)) {
    refuse("task claim destination changed during write");
  }
}

function writePrivateFile(identities, fileName, content, flag) {
  if (Buffer.byteLength(content, "utf8") > MAX_CLAIM_BYTES) {
    refuse("task claim entry exceeds the storage limit");
  }
  const existing = lstatOptional(fileName);
  if (existing && (existing.isSymbolicLink() || !existing.isFile() || existing.nlink !== 1)) {
    refuse("task claim entries must be private regular files");
  }
  if (flag === "wx" && existing !== undefined) {
    refuse("task claim entry already exists");
  }
  const expectedIdentity = existing === undefined ? null : identity(existing);
  const directoryFd = openSync(
    ".",
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const temporaryName = ".task-claim." + process.pid + "." + randomUUID() + ".tmp";
  let temporaryFd;
  let temporaryIdentity;
  let installed = false;
  try {
    inspectChain(identities);
    temporaryFd = openSync(
      temporaryName,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      FILE_MODE,
    );
    const temporaryStats = fstatSync(temporaryFd);
    if (!temporaryStats.isFile() || temporaryStats.nlink !== 1) {
      refuse("task claim temporary entry is not a private regular file");
    }
    temporaryIdentity = identity(temporaryStats);
    fchmodSync(temporaryFd, FILE_MODE);
    writeFileSync(temporaryFd, content, "utf8");
    fsyncSync(temporaryFd);

    inspectChain(identities);
    inspectExpectedDestination(fileName, expectedIdentity);
    if (flag === "wx") {
      linkSync(temporaryName, fileName);
      unlinkSync(temporaryName);
    } else {
      renameSync(temporaryName, fileName);
    }
    installed = true;

    const installedStats = lstatSync(fileName);
    if (
      !installedStats.isFile() ||
      installedStats.nlink !== 1 ||
      !sameFile(installedStats, temporaryIdentity)
    ) {
      refuse("task claim entry changed while it was installed");
    }
    fsyncSync(directoryFd);
  } finally {
    if (temporaryFd !== undefined) closeSync(temporaryFd);
    if (!installed) cleanupTemporaryFile(temporaryName, temporaryIdentity);
    closeSync(directoryFd);
  }
}
`;
