import { ANCHORED_RECORD_STORAGE_ANCHOR_HELPER_SOURCE } from "./anchored-record-storage-anchor-helper-source.js";

/**
 * Node does not expose openat(2). The isolated helper anchors its working
 * directory to the verified record-directory inode and uses relative,
 * no-follow operations for every record access.
 */
export const ANCHORED_RECORD_STORAGE_HELPER_SOURCE = `
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const RECORD_PATTERN = /^[0-9a-f]{8}\\.json$/;
const WRITE_CHUNK_BYTES = 64 * 1024;

${ANCHORED_RECORD_STORAGE_ANCHOR_HELPER_SOURCE}

function inspectRecord(filename, expectedIdentity, writable = false) {
  inspectDirectory(request);
  const pathStats = lstatOptional(filename);
  if (pathStats === undefined) {
    if (expectedIdentity !== undefined && expectedIdentity !== null) {
      refuse("record changed during the transition");
    }
    return undefined;
  }
  if (pathStats.isSymbolicLink()) {
    refuse("record must not be a symbolic link");
  }
  if (!pathStats.isFile() || pathStats.nlink !== 1) {
    refuse("record must be a regular file with one link");
  }
  requireDaemonOwner(pathStats, "record");
  if (expectedIdentity === null) {
    refuse("record changed during the transition");
  }

  const fd = openSync(
    filename,
    (writable ? constants.O_RDWR : constants.O_RDONLY) |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK,
  );
  try {
    const openedStats = fstatSync(fd);
    const openedIdentity = identity(openedStats);
    const currentStats = lstatSync(filename);
    requireDaemonOwner(openedStats, "record");
    if (
      !openedStats.isFile() ||
      openedStats.nlink !== 1 ||
      !sameFile(identity(pathStats), openedIdentity) ||
      !sameFile(identity(currentStats), openedIdentity) ||
      (expectedIdentity !== undefined &&
        !sameFile(expectedIdentity, openedIdentity))
    ) {
      refuse("record changed during the transition");
    }
    inspectDirectory(request);
    fchmodSync(fd, FILE_MODE);
    return { fd, identity: openedIdentity };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function readRecord(filename) {
  const opened = inspectRecord(filename, undefined);
  if (opened === undefined) return { exists: false };
  try {
    const contents = readFileSync(opened.fd, "utf8");
    const currentStats = lstatSync(filename);
    if (!sameFile(identity(currentStats), opened.identity)) {
      refuse("record changed during the transition");
    }
    inspectDirectory(request);
    return { exists: true, contents, identity: opened.identity };
  } finally {
    closeSync(opened.fd);
  }
}

function recordNames() {
  const names = readdirSync(".").filter((name) => name.endsWith(".json"));
  if (names.some((name) => !RECORD_PATTERN.test(name))) {
    refuse("record filename is invalid");
  }
  return names.sort();
}

function listRecords() {
  return recordNames().map((filename) => ({ filename, ...readRecord(filename) }));
}

function cleanupCreatedRecord(name, expectedIdentity) {
  if (expectedIdentity === undefined) return;
  const stats = lstatOptional(name);
  if (stats !== undefined && sameFile(identity(stats), expectedIdentity)) {
    unlinkSync(name);
  }
}

function assertRecordIdentity(filename, expectedIdentity) {
  const currentStats = lstatOptional(filename);
  if (currentStats === undefined || currentStats.isSymbolicLink()) {
    refuse("record changed during the transition");
  }
  requireDaemonOwner(currentStats, "record");
  if (
    !currentStats.isFile() ||
    currentStats.nlink !== 1 ||
    !sameFile(identity(currentStats), expectedIdentity)
  ) {
    refuse("record changed during the transition");
  }
}

function writeContents(fd, contents) {
  const bytes = Buffer.from(contents, "utf8");
  ftruncateSync(fd, 0);
  let offset = 0;
  while (offset < bytes.length) {
    const length = Math.min(WRITE_CHUNK_BYTES, bytes.length - offset);
    const written = writeSync(fd, bytes, offset, length, offset);
    if (written <= 0) refuse("record write made no progress");
    offset += written;
  }
}

function createRecord(filename, contents, directoryFd) {
  inspectRecord(filename, null);
  inspectDirectory(request);
  let fd;
  let createdIdentity;
  let completed = false;
  try {
    fd = openSync(
      filename,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      FILE_MODE,
    );
    const createdStats = fstatSync(fd);
    requireDaemonOwner(createdStats, "record");
    if (!createdStats.isFile() || createdStats.nlink !== 1) {
      refuse("record must be a private regular file");
    }
    createdIdentity = identity(createdStats);
    fchmodSync(fd, FILE_MODE);
    writeContents(fd, contents);
    fsyncSync(fd);
    const writtenStats = fstatSync(fd);
    if (writtenStats.nlink !== 1 || !sameFile(identity(writtenStats), createdIdentity)) {
      refuse("record changed during the transition");
    }
    assertRecordIdentity(filename, createdIdentity);
    inspectDirectory(request);
    fsyncSync(directoryFd);
    completed = true;
    return createdIdentity;
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (!completed) {
      cleanupCreatedRecord(filename, createdIdentity);
      fsyncSync(directoryFd);
    }
  }
}

function updateRecord(filename, contents, expectedIdentity, directoryFd) {
  const opened = inspectRecord(filename, expectedIdentity, true);
  if (opened === undefined) refuse("record changed during the transition");
  try {
    inspectDirectory(request);
    writeContents(opened.fd, contents);
    fsyncSync(opened.fd);
    const writtenStats = fstatSync(opened.fd);
    if (
      writtenStats.nlink !== 1 ||
      !sameFile(identity(writtenStats), opened.identity)
    ) {
      refuse("record changed during the transition");
    }
    assertRecordIdentity(filename, opened.identity);
    inspectDirectory(request);
    fsyncSync(directoryFd);
    return opened.identity;
  } finally {
    closeSync(opened.fd);
  }
}

function writeRecord(filename, contents, expectedIdentity, directoryFd) {
  return expectedIdentity === null
    ? createRecord(filename, contents, directoryFd)
    : updateRecord(filename, contents, expectedIdentity, directoryFd);
}

function clearRecords(directoryFd) {
  for (const filename of recordNames()) {
    const opened = inspectRecord(filename, undefined);
    if (opened === undefined) continue;
    closeSync(opened.fd);
    const currentStats = lstatSync(filename);
    if (!sameFile(identity(currentStats), opened.identity)) {
      refuse("record changed during the transition");
    }
    unlinkSync(filename);
  }
  inspectDirectory(request);
  fsyncSync(directoryFd);
}

function respond(response) {
  process.stdout.write(JSON.stringify(response));
}

let request;
try {
  request = JSON.parse(readFileSync(0, "utf8"));
  if (
    request === null ||
    typeof request !== "object" ||
    !["read", "list", "write", "clear"].includes(request.operation) ||
    typeof request.directoryPath !== "string"
  ) {
    refuse("record filesystem request is invalid");
  }
  validateIdentity(request.directoryIdentity, "record directory identity");
  if (!Array.isArray(request.directoryAnchors) || request.directoryAnchors.length === 0) {
    refuse("record directory anchors are invalid");
  }
  for (const anchor of request.directoryAnchors) {
    if (anchor === null || typeof anchor !== "object" || typeof anchor.path !== "string") {
      refuse("record directory anchor is invalid");
    }
    validateIdentity(anchor.identity, "record directory ancestor identity");
  }
  if (request.operation === "read" || request.operation === "write") {
    if (typeof request.filename !== "string" || !RECORD_PATTERN.test(request.filename)) {
      refuse("record filename is invalid");
    }
  }
  if (request.operation === "write") {
    if (request.expectedIdentity !== null) {
      validateIdentity(request.expectedIdentity, "expected record identity");
    }
    if (typeof request.contents !== "string") {
      refuse("record contents are invalid");
    }
  }

  const directoryFd = anchorDirectory(request);
  try {
    if (request.operation === "read") {
      respond({ ok: true, snapshot: readRecord(request.filename) });
    } else if (request.operation === "list") {
      respond({ ok: true, snapshots: listRecords() });
    } else if (request.operation === "write") {
      respond({
        ok: true,
        identity: writeRecord(
          request.filename,
          request.contents,
          request.expectedIdentity,
          directoryFd,
        ),
      });
    } else {
      clearRecords(directoryFd);
      respond({ ok: true });
    }
  } finally {
    closeSync(directoryFd);
  }
} catch (error) {
  const reason =
    error && typeof error.safeReason === "string"
      ? error.safeReason
      : "record filesystem operation failed (" +
        (error && typeof error.code === "string" ? error.code : "unknown") +
        ")";
  respond({ ok: false, reason });
}
`;
