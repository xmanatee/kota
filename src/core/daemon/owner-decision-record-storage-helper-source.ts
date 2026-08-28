import { OWNER_DECISION_RECORD_STORAGE_ANCHOR_HELPER_SOURCE } from "./owner-decision-record-storage-anchor-helper-source.js";

/**
 * Node does not expose openat(2). The isolated helper anchors its working
 * directory to the verified owner-decision directory inode and uses relative,
 * no-follow operations for every record access.
 */
export const OWNER_DECISION_RECORD_STORAGE_HELPER_SOURCE = `
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

${OWNER_DECISION_RECORD_STORAGE_ANCHOR_HELPER_SOURCE}

function inspectRecord(filename, expectedIdentity, writable = false) {
  inspectDirectory(request);
  const pathStats = lstatOptional(filename);
  if (pathStats === undefined) {
    if (expectedIdentity !== undefined && expectedIdentity !== null) {
      refuse("owner decision record changed during the transition");
    }
    return undefined;
  }
  if (pathStats.isSymbolicLink()) {
    refuse("owner decision record must not be a symbolic link");
  }
  if (!pathStats.isFile() || pathStats.nlink !== 1) {
    refuse("owner decision record must be a regular file with one link");
  }
  requireDaemonOwner(pathStats, "owner decision record");
  if (expectedIdentity === null) {
    refuse("owner decision record changed during the transition");
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
    requireDaemonOwner(openedStats, "owner decision record");
    if (
      !openedStats.isFile() ||
      openedStats.nlink !== 1 ||
      !sameFile(identity(pathStats), openedIdentity) ||
      !sameFile(identity(currentStats), openedIdentity) ||
      (expectedIdentity !== undefined &&
        !sameFile(expectedIdentity, openedIdentity))
    ) {
      refuse("owner decision record changed during the transition");
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
      refuse("owner decision record changed during the transition");
    }
    inspectDirectory(request);
    return { exists: true, contents, identity: opened.identity };
  } finally {
    closeSync(opened.fd);
  }
}

function recordNames() {
  const names = readdirSync(".").filter((name) => name.endsWith(".json"));
  for (const name of names) {
    if (!RECORD_PATTERN.test(name)) {
      refuse("unexpected file in owner decision directory: " + name);
    }
  }
  return names.sort();
}

function createRecord(filename) {
  const fd = openSync(
    filename,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK,
    FILE_MODE,
  );
  try {
    fchmodSync(fd, FILE_MODE);
    const stats = fstatSync(fd);
    requireDaemonOwner(stats, "owner decision record");
    if (!stats.isFile() || stats.nlink !== 1) {
      refuse("owner decision record must be a regular file with one link");
    }
    return { fd, identity: identity(stats) };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function writeRecord(filename, contents, expectedIdentity) {
  const opened =
    expectedIdentity === null
      ? createRecord(filename)
      : inspectRecord(filename, expectedIdentity, true);
  if (opened === undefined) {
    refuse("owner decision record disappeared before write");
  }
  try {
    ftruncateSync(opened.fd, 0);
    const buffer = Buffer.from(contents, "utf8");
    let offset = 0;
    while (offset < buffer.byteLength) {
      const chunkLength = Math.min(
        buffer.byteLength - offset,
        WRITE_CHUNK_BYTES,
      );
      offset += writeSync(opened.fd, buffer, offset, chunkLength, offset);
    }
    fsyncSync(opened.fd);
    const currentStats = lstatSync(filename);
    if (!sameFile(identity(currentStats), opened.identity)) {
      refuse("owner decision record changed during write");
    }
    inspectDirectory(request);
    return opened.identity;
  } finally {
    closeSync(opened.fd);
  }
}

function clearRecords() {
  for (const name of recordNames()) {
    const stats = lstatSync(name);
    if (stats.isSymbolicLink()) {
      refuse("owner decision record must not be a symbolic link");
    }
    if (!stats.isFile() || stats.nlink !== 1) {
      refuse("owner decision record must be a regular file with one link");
    }
    requireDaemonOwner(stats, "owner decision record");
    unlinkSync(name);
  }
  inspectDirectory(request);
}

const inputChunks = [];
for await (const chunk of process.stdin) inputChunks.push(chunk);
const request = JSON.parse(Buffer.concat(inputChunks).toString("utf8"));

if (
  request === null ||
  typeof request !== "object" ||
  typeof request.operation !== "string" ||
  typeof request.directoryPath !== "string"
) {
  refuse("invalid storage request");
}

validateIdentity(request.directoryIdentity, "directoryIdentity");
if (
  request.expectedIdentity !== undefined &&
  request.expectedIdentity !== null
) {
  validateIdentity(request.expectedIdentity, "expectedIdentity");
}
if (request.filename !== undefined && !RECORD_PATTERN.test(request.filename)) {
  refuse("malformed owner decision record filename: " + request.filename);
}

anchorDirectory(request);

let response;
if (request.operation === "read") {
  if (typeof request.filename !== "string") {
    refuse("read requires a filename");
  }
  response = { ok: true, snapshot: readRecord(request.filename) };
} else if (request.operation === "list") {
  const snapshots = [];
  for (const filename of recordNames()) {
    const snapshot = readRecord(filename);
    if (snapshot.exists) snapshots.push({ filename, ...snapshot });
  }
  response = { ok: true, snapshots };
} else if (request.operation === "write") {
  if (
    typeof request.filename !== "string" ||
    typeof request.contents !== "string"
  ) {
    refuse("write requires a filename and contents");
  }
  response = {
    ok: true,
    identity: writeRecord(
      request.filename,
      request.contents,
      request.expectedIdentity,
    ),
  };
} else if (request.operation === "clear") {
  clearRecords();
  response = { ok: true };
} else {
  refuse("unsupported storage operation: " + request.operation);
}

process.stdout.write(JSON.stringify(response));
`;
