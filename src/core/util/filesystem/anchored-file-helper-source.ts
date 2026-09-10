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
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";

${ANCHORED_FILE_COMMON_SOURCE}
${ANCHORED_FILE_OPERATIONS_SOURCE}

function respond(response) {
  process.stdout.write(JSON.stringify(response));
}

try {
  requireNoFollowPrimitives();
  const request = JSON.parse(readFileSync(0, "utf8"));
  if (
    request === null ||
    typeof request !== "object" ||
    (request.operation !== "list" &&
      request.operation !== "read" &&
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
    (request.operation !== "list" &&
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

  const parentIdentity = enterParent(request);
  if (parentIdentity === undefined) {
    respond(
      request.operation === "list"
        ? { ok: true, entries: [] }
        : { ok: true, snapshot: { exists: false } },
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
      if (request.operation === "list") {
        respond({ ok: true, entries: listTextFiles(request, parentIdentity) });
      } else if (request.operation === "read") {
        respond({ ok: true, snapshot: readTextFile(request, parentIdentity) });
      } else if (request.operation === "write") {
        respond({
          ok: true,
          installedSnapshot: writeTextFile(request, parentIdentity, directoryFd),
        });
      } else {
        removeTextFile(request, parentIdentity, directoryFd);
        respond({ ok: true, removed: true });
      }
    } finally {
      closeSync(directoryFd);
    }
  }
} catch (error) {
  const reason =
    error && typeof error.safeReason === "string"
      ? error.safeReason
      : "anchored filesystem operation failed (" +
        (error && typeof error.code === "string" ? error.code : "unknown") +
        (error && typeof error.syscall === "string" ? ": " + error.syscall : "") +
        ")";
  respond({ ok: false, reason });
}
`;
