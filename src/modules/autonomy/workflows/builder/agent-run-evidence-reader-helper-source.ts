import { EVIDENCE_FILESYSTEM_COMMON_SOURCE } from "./agent-run-evidence-filesystem-helper-source.js";
import { BUILDER_EVIDENCE_MAX_FILE_BYTES } from "./agent-run-evidence-manifest.js";

export const EVIDENCE_READER_HELPER_SOURCE = `
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";

${EVIDENCE_FILESYSTEM_COMMON_SOURCE}

const MAX_FILE_BYTES = ${BUILDER_EVIDENCE_MAX_FILE_BYTES};

function stableFile(before, after) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.mode === after.mode &&
    before.nlink === after.nlink &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs
  );
}

function readBoundedFile(request) {
  inspectAnchoredDirectory(request);
  const fd = openSync(
    request.fileName,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n) {
      refuse("Builder evidence source must be a private regular file");
    }
    if (before.size > BigInt(request.maxBytes)) {
      refuse("registered artifact exceeds the per-file limit");
    }
    const buffer = Buffer.alloc(request.maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const bytesRead = readSync(fd, buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > request.maxBytes) {
      refuse("registered artifact exceeds the per-file limit");
    }
    const after = fstatSync(fd, { bigint: true });
    if (!stableFile(before, after) || BigInt(length) !== after.size) {
      refuse("Builder evidence source changed while it was being read");
    }
    inspectAnchoredDirectory(request);
    return buffer.subarray(0, length);
  } finally {
    closeSync(fd);
  }
}

function listDirectory(request) {
  inspectAnchoredDirectory(request);
  const entries = readdirSync(".", { withFileTypes: true }).map((entry) => {
    const stats = lstatSync(entry.name);
    if (entry.isSymbolicLink() || stats.isSymbolicLink()) {
      refuse("Builder evidence projection contains a symbolic link");
    }
    if (entry.isDirectory() && stats.isDirectory()) {
      return { name: entry.name, kind: "directory" };
    }
    if (entry.isFile() && stats.isFile() && stats.nlink === 1) {
      return { name: entry.name, kind: "file" };
    }
    refuse("Builder evidence projection contains a non-private file");
  });
  inspectAnchoredDirectory(request);
  return entries;
}

try {
  requireNoFollowPrimitives();
  const request = JSON.parse(readFileSync(0, "utf8"));
  if (
    request === null ||
    typeof request !== "object" ||
    (request.operation !== "read" && request.operation !== "list") ||
    typeof request.directoryPath !== "string" ||
    typeof request.directoryRealPath !== "string" ||
    typeof request.workspacePath !== "string" ||
    typeof request.workspaceRealPath !== "string" ||
    !Array.isArray(request.ancestorIdentities) ||
    request.ancestorIdentities.length === 0
  ) {
    refuse("Builder evidence filesystem request is invalid");
  }
  for (const value of request.ancestorIdentities) {
    validateIdentity(value, "ancestor identity");
  }
  validateIdentity(request.workspaceIdentity, "workspace identity");
  if (request.operation === "read") {
    if (
      typeof request.fileName !== "string" ||
      !request.fileName ||
      request.fileName === "." ||
      request.fileName === ".." ||
      request.fileName.includes("/") ||
      request.fileName.includes("\\\\") ||
      !Number.isSafeInteger(request.maxBytes) ||
      request.maxBytes < 0 ||
      request.maxBytes > MAX_FILE_BYTES
    ) {
      refuse("Builder evidence read request is invalid");
    }
    const content = readBoundedFile(request);
    respond({ ok: true, content: content.toString("base64") });
  } else {
    respond({ ok: true, entries: listDirectory(request) });
  }
} catch (error) {
  const reason = error && typeof error.safeReason === "string"
    ? error.safeReason
    : "Builder evidence filesystem operation failed (" +
      (error && typeof error.code === "string" ? error.code : "unknown") + ")";
  respond({ ok: false, reason });
}
`;
