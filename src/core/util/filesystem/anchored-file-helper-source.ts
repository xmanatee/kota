import { ANCHORED_FILE_COMMON_SOURCE } from "./anchored-file-common-source.js";
import { ANCHORED_FILE_OPERATIONS_SOURCE } from "./anchored-file-operations-source.js";

/*
 * Node does not expose openat(2), renameat(2), or unlinkat(2). This helper
 * enters each verified directory in an isolated process and performs leaf
 * operations relative to the anchored working directory. Replacing a checked
 * parent pathname therefore cannot redirect a mutation to another directory.
 */
export const ANCHORED_FILE_HELPER_SOURCE = `
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";

${ANCHORED_FILE_COMMON_SOURCE}
${ANCHORED_FILE_OPERATIONS_SOURCE}

function respond(response) {
  process.stdout.write(JSON.stringify(response));
}

function execute(request) {
  requireNoFollowPrimitives();
  if (
    request === null ||
    typeof request !== "object" ||
    (request.operation !== "list" && request.operation !== "list-entries" &&
      request.operation !== "read" &&
      request.operation !== "append" &&
      request.operation !== "write" &&
      request.operation !== "remove") ||
    typeof request.rootPath !== "string" ||
    typeof request.parentPath !== "string" ||
    !Array.isArray(request.parentParts) ||
    request.parentParts.some(
      (part) =>
        typeof part !== "string" ||
        !part ||
        part === "." ||
        part === ".." ||
        part.includes("/") ||
        part.includes("\\\\"),
    ) ||
    (request.operation !== "list" && request.operation !== "list-entries" &&
      (typeof request.fileName !== "string" ||
        !request.fileName ||
        request.fileName === "." ||
        request.fileName === ".." ||
        request.fileName.includes("/") ||
        request.fileName.includes("\\\\"))) ||
    typeof request.createParent !== "boolean"
  ) {
    refuse("anchored filesystem request is invalid");
  }
  validateIdentity(request.rootIdentity, "filesystem root identity");
  if (
    request.operation === "list" &&
    request.nameSuffix !== null &&
    typeof request.nameSuffix !== "string"
  ) {
    refuse("anchored filesystem listing suffix is invalid");
  }
  if (request.operation === "write") {
    if (
      (request.expectation !== "any" &&
        request.expectation !== "missing" &&
        request.expectation !== "existing") ||
      typeof request.content !== "string"
    ) {
      refuse("anchored file write request is invalid");
    }
    if (request.expectation === "existing") {
      validateSnapshot(request.expectedSnapshot, "expected file snapshot");
    }
  }
  if (request.operation === "remove") {
    validateSnapshot(request.expectedSnapshot, "expected file snapshot");
  }
  if (request.operation === "append" && typeof request.content !== "string") {
    refuse("anchored file append request is invalid");
  }

  if (request.encoding !== undefined && (request.encoding !== "base64" ||
    !["read", "write"].includes(request.operation) ||
    (request.operation === "read" && (!Number.isSafeInteger(request.maxBytes) || request.maxBytes < 0 || request.maxBytes > 33554432 || request.lines !== undefined)))) {
    refuse("invalid binary file request");
  }
  const parentIdentity = enterParent(request);
  if (parentIdentity === undefined) {
    return (
      request.operation === "list-entries" ? { ok: true, directoryEntries: [] } : request.operation === "list"
        ? { ok: true, entries: [] }
        : { ok: true, snapshot: { exists: false } }
    );
  } else {
    const directoryFd = openSync(
      ".",
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      if (!sameIdentity(fstatSync(directoryFd), parentIdentity)) {
        refuse("parent directory changed while it was opened");
      }
      if (request.operation === "list-entries") {
        return { ok: true, directoryEntries: listDirectoryEntries(request, parentIdentity) };
      } else if (request.operation === "list") {
        return { ok: true, entries: listTextFiles(request, parentIdentity) };
      } else if (request.operation === "read") {
        return { ok: true, snapshot: readTextFile(request, parentIdentity) };
      } else if (request.operation === "append") {
        appendTextFile(request, parentIdentity, directoryFd);
        return { ok: true };
      } else if (request.operation === "write") {
        return {
          ok: true,
          installedSnapshot: writeTextFile(request, parentIdentity, directoryFd),
        };
      } else {
        removeTextFile(request, parentIdentity, directoryFd);
        return { ok: true, removed: true };
      }
    } finally {
      closeSync(directoryFd);
    }
  }
}

function failure(error) {
  const reason =
    error && typeof error.safeReason === "string"
      ? error.safeReason
      : "anchored filesystem operation failed (" +
        (error && typeof error.code === "string" ? error.code : "unknown") +
        (error && typeof error.syscall === "string" ? ": " + error.syscall : "") +
        ")";
  return { ok: false, reason };
}
try {
  const request = JSON.parse(readFileSync(0, "utf8"));
  if (request.operation === "read-batch") {
    if (!Array.isArray(request.requests) || request.requests.length > 64 ||
      request.requests.some(item => item.operation !== "read" || !Number.isSafeInteger(item.maxBytes) || item.maxBytes < 0 || item.maxBytes > 131072 ||
        (item.lines !== undefined && (item.lines === null || !Array.isArray(item.lines.digests) ||
          item.lines.digests.length > 64 || item.lines.digests.some(digest => typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) ||
          !Number.isSafeInteger(item.lines.tailLines) || item.lines.tailLines < 0 || item.lines.tailLines > 1000)))) {
      refuse("invalid bounded batch read");
    }
    const files = request.requests.map(item => {
      try {
        const result = execute(item);
        return { ok: true, file: result.snapshot.exists
          ? { content: result.snapshot.content, snapshot: result.snapshot.snapshot } : null };
      } catch (error) { return failure(error); }
    });
    respond({ ok: true, files });
  } else { respond(execute(request)); }
} catch (error) { respond(failure(error)); }
`;
