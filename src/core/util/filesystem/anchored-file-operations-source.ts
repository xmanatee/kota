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

function decodeText(bytes) {
  const content = bytes.toString("utf8");
  if (!Buffer.from(content, "utf8").equals(bytes)) {
    refuse("file content is not lossless UTF-8");
  }
  return content;
}

function readTextFile(request, parentIdentity) {
  inspectAnchoredParent(request, parentIdentity);
  const opened = inspectTextFileEntry(request.fileName, undefined);
  if (opened === undefined) return { exists: false };
  try {
    let content;
    if (request.lines !== undefined) {
      content = readSelectedLines(opened, request);
    } else if (request.maxBytes !== undefined) {
      if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes < 0 || opened.snapshot.size > request.maxBytes) {
        refuse("file exceeds read limit");
      }
      const bytes = Buffer.alloc(Math.min(request.maxBytes, opened.snapshot.size) + 1);
      let length = 0;
      while (length < bytes.length) {
        const count = readSync(opened.fd, bytes, length, bytes.length - length, length);
        if (count === 0) break;
        length += count;
      }
      if (length > request.maxBytes) refuse("file exceeds read limit");
      content = request.encoding === "base64" ? bytes.subarray(0, length).toString("base64") : decodeText(bytes.subarray(0, length));
    } else {
      content = decodeText(readFileSync(opened.fd));
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

// Stream the opening snapshot only. Memory and output depend on selected lines,
// not log size; the caller still receives a snapshot-verified result.
function readSelectedLines(opened, request) {
  const selected = [];
  const recent = [];
  const wanted = new Set(request.lines.digests);
  let selectedBytes = 0;
  let recentBytes = 0;
  let lineBytes = 0;
  let parts = [];
  let hash = createHash("sha256");
  let pendingCR = false;
  const chunk = Buffer.alloc(16384);
  function append(bytes) {
    hash.update(bytes);
    lineBytes += bytes.length;
    if (lineBytes <= request.maxBytes) parts.push(Buffer.from(bytes));
    else parts = [];
  }
  function finish() {
    const digest = hash.digest("hex");
    const exact = wanted.has(digest);
    if (exact && lineBytes + 1 > request.maxBytes) refuse("selected line exceeds read limit");
    if (lineBytes > 0 && lineBytes + 1 <= request.maxBytes) {
      const text = decodeText(Buffer.concat(parts));
      const entry = { text, bytes: lineBytes + 1 };
      if (exact) {
        selected.push(entry);
        selectedBytes += entry.bytes;
        if (selectedBytes > request.maxBytes) refuse("selected lines exceed read limit");
      } else if (request.lines.tailLines > 0) {
        recent.push(entry);
        recentBytes += entry.bytes;
      }
      while (recent.length > request.lines.tailLines || recentBytes + selectedBytes > request.maxBytes) {
        recentBytes -= recent.shift().bytes;
      }
    }
    lineBytes = 0;
    parts = [];
    hash = createHash("sha256");
    pendingCR = false;
  }
  let position = 0;
  while (position < opened.snapshot.size) {
    const count = readSync(opened.fd, chunk, 0, Math.min(chunk.length, opened.snapshot.size - position), position);
    if (count === 0) refuse("file entry changed while it was read");
    position += count;
    let start = 0;
    // Hold a trailing CR until the following byte distinguishes CRLF from data.
    for (let index = 0; index < count; index++) {
      if (chunk[index] !== 10) continue;
      let end = index;
      if (pendingCR && index > start) append(Buffer.from([13]));
      if (end > start && chunk[end - 1] === 13) end--;
      append(chunk.subarray(start, end));
      finish();
      start = index + 1;
    }
    if (start < count) {
      if (pendingCR) append(Buffer.from([13]));
      const end = chunk[count - 1] === 13 ? count - 1 : count;
      append(chunk.subarray(start, end));
      pendingCR = end !== count;
    }
  }
  if (pendingCR) append(Buffer.from([13]));
  if (lineBytes > 0) finish();
  return [...selected, ...recent].map(entry => entry.text).join("\\n");
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
    writeFileSync(temporaryFd, request.content, request.encoding === "base64" ? "base64" : "utf8");
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
