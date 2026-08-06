import { TASK_CLAIM_FILESYSTEM_COMMON_SOURCE } from "./task-claim-filesystem-common-source.js";
import { TASK_CLAIM_FILESYSTEM_FILE_SOURCE } from "./task-claim-filesystem-file-source.js";

/*
 * Node does not expose openat(2)/renameat(2). This isolated helper starts in
 * the identity-checked project directory, enters each claim-store directory
 * one component at a time, and uses only relative leaf operations from the
 * anchored working directory. A renamed ancestor therefore fails identity
 * checks instead of redirecting host-authority filesystem access.
 */
export const TASK_CLAIM_FILESYSTEM_HELPER_SOURCE = `
${TASK_CLAIM_FILESYSTEM_COMMON_SOURCE}
${TASK_CLAIM_FILESYSTEM_FILE_SOURCE}

function enterActive(request, create) {
  const identities = enterClaimsRoot(request, create);
  if (identities === null) return null;
  if (!enterDirectory("active", identities, create)) return null;
  return identities;
}

function readActive(request) {
  const identities = enterActive(request, false);
  if (identities === null) return { ok: true, content: null };
  inspectChain(identities);
  const entry = inspectPrivateFile(request.fileName);
  if (entry === null) return { ok: true, content: null };
  validateStoredTaskId(entry.content, request.taskId, request.fileName);
  return { ok: true, content: entry.content };
}

function listActive(request) {
  const identities = enterActive(request, false);
  if (identities === null) return { ok: true, available: false, entries: [] };
  inspectChain(identities);
  const entries = [];
  for (const name of readdirSync(".").filter((entry) => entry.endsWith(".json")).sort()) {
    const entry = inspectPrivateFile(name);
    if (entry === null) refuse("task claim entry disappeared during listing");
    let parsed;
    try {
      parsed = JSON.parse(entry.content);
    } catch {
      refuse("task claim entry contains malformed JSON");
    }
    if (parsed === null || typeof parsed !== "object" || typeof parsed.taskId !== "string") {
      refuse("stored task claim id does not match its requested filename");
    }
    validateStoredTaskId(entry.content, parsed.taskId, name);
    entries.push({ name, taskId: parsed.taskId, content: entry.content });
  }
  return { ok: true, available: true, entries };
}

function writeActive(request) {
  validateStoredTaskId(request.content, request.taskId, request.fileName);
  const identities = enterActive(request, true);
  writePrivateFile(identities, request.fileName, request.content, request.flag);
  return { ok: true };
}

function writeHistoryCopy(request, removeActive) {
  let identities = enterActive(request, false);
  if (identities === null) refuse("active task claim disappeared before archival");
  const claimsRootDepth = identities.length - 1;
  const source = inspectPrivateFile(request.fileName);
  if (source === null) refuse("active task claim disappeared before archival");
  validateStoredTaskId(source.content, request.taskId, request.fileName);
  leaveToDepth(identities, claimsRootDepth);

  enterDirectory("history", identities, true);
  enterDirectory(request.historyTaskSegment, identities, true);
  writePrivateFile(identities, request.historyFileName, source.content, "wx");

  if (!removeActive) return { ok: true };
  leaveToDepth(identities, claimsRootDepth);
  if (!enterDirectory("active", identities, false)) {
    refuse("active task claim directory disappeared during archival");
  }
  const current = inspectPrivateFile(request.fileName);
  if (
    current === null ||
    !sameFile(current.identity, source.identity) ||
    current.content !== source.content
  ) {
    refuse("active task claim changed during archival");
  }
  inspectChain(identities);
  unlinkSync(request.fileName);
  return { ok: true };
}

function acquireLock(request) {
  const identities = enterClaimsRoot(request, true);
  enterDirectory("locks", identities, true);
  const existing = lstatOptional(request.lockFileName);
  if (existing !== undefined) {
    if (existing.isSymbolicLink() || !existing.isFile() || existing.nlink !== 1) {
      refuse("task claim lock entries must be private regular files");
    }
    return { ok: true, acquired: false };
  }
  try {
    writePrivateFile(identities, request.lockFileName, request.content, "wx");
  } catch (error) {
    if (
      error &&
      (error.code === "EEXIST" ||
        error.safeReason === "task claim destination changed during write" ||
        error.safeReason === "task claim entry already exists")
    ) {
      return { ok: true, acquired: false };
    }
    throw error;
  }
  const installed = lstatSync(request.lockFileName);
  return { ok: true, acquired: true, lockIdentity: identity(installed) };
}

function releaseLock(request) {
  const identities = enterClaimsRoot(request, false);
  if (identities === null || !enterDirectory("locks", identities, false)) {
    refuse("task claim lock disappeared before release");
  }
  const current = inspectPrivateFile(request.lockFileName);
  if (current === null || !sameFile(current.identity, request.lockIdentity)) {
    refuse("task claim lock changed before release");
  }
  inspectChain(identities);
  unlinkSync(request.lockFileName);
  return { ok: true };
}

function validateRequest(request) {
  if (
    request === null ||
    typeof request !== "object" ||
    typeof request.projectPath !== "string" ||
    typeof request.projectRealPath !== "string" ||
    typeof request.operation !== "string"
  ) {
    refuse("task claim filesystem request is invalid");
  }
  validateIdentity(request.projectIdentity, "project identity");
  if (request.operation === "list-active") return;
  if (request.operation === "release-lock") {
    validateSegment(request.lockFileName, "lock filename");
    validateIdentity(request.lockIdentity, "lock identity");
    return;
  }
  if (request.operation === "acquire-lock") {
    validateSegment(request.lockFileName, "lock filename");
    if (typeof request.content !== "string") refuse("task claim lock content is invalid");
    return;
  }
  validateSegment(request.fileName, "claim filename");
  if (typeof request.taskId !== "string" || !request.taskId) {
    refuse("task claim id is invalid");
  }
  if (request.operation === "read-active") return;
  if (request.operation === "write-active") {
    if (typeof request.content !== "string" || (request.flag !== "w" && request.flag !== "wx")) {
      refuse("task claim write request is invalid");
    }
    return;
  }
  if (request.operation === "archive-active" || request.operation === "copy-active-history") {
    validateSegment(request.historyTaskSegment, "history task directory");
    validateSegment(request.historyFileName, "history filename");
    return;
  }
  refuse("task claim filesystem operation is invalid");
}

function respond(response) {
  process.stdout.write(JSON.stringify(response));
}

try {
  requireNoFollowPrimitives();
  const request = JSON.parse(readFileSync(0, "utf8"));
  validateRequest(request);
  currentRequest = request;
  let response;
  switch (request.operation) {
    case "read-active": response = readActive(request); break;
    case "list-active": response = listActive(request); break;
    case "write-active": response = writeActive(request); break;
    case "archive-active": response = writeHistoryCopy(request, true); break;
    case "copy-active-history": response = writeHistoryCopy(request, false); break;
    case "acquire-lock": response = acquireLock(request); break;
    case "release-lock": response = releaseLock(request); break;
    default: refuse("task claim filesystem operation is invalid");
  }
  respond(response);
} catch (error) {
  const reason = error && typeof error.safeReason === "string"
    ? error.safeReason
    : "task claim filesystem operation failed (" +
      (error && typeof error.code === "string" ? error.code : "unknown") + ")";
  respond({ ok: false, reason });
}
`;
