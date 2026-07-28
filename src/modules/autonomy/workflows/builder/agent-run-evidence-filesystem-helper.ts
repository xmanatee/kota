import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync, type Stats } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { EVIDENCE_READER_HELPER_SOURCE } from "./agent-run-evidence-reader-helper-source.js";
import { EVIDENCE_WRITER_HELPER_SOURCE } from "./agent-run-evidence-writer-helper-source.js";
import { isBuilderPathInside } from "./workspace.js";

const HELPER_MAX_BUFFER = 16 * 1024 * 1024;

export type BuilderEvidenceFileIdentity = {
  dev: number;
  ino: number;
};

export type BuilderEvidenceReadRequest = {
  operation: "read";
  ancestorIdentities: BuilderEvidenceFileIdentity[];
  directoryPath: string;
  directoryRealPath: string;
  fileName: string;
  maxBytes: number;
  workspaceIdentity: BuilderEvidenceFileIdentity;
  workspacePath: string;
  workspaceRealPath: string;
};

type BuilderEvidenceListRequest = Omit<
  BuilderEvidenceReadRequest,
  "fileName" | "maxBytes" | "operation"
> & { operation: "list" };

export type BuilderEvidenceProjectionRequest = {
  content: string;
  directoryParts: string[];
  expectedDestinationIdentity: BuilderEvidenceFileIdentity | null;
  fileName: string;
  workspaceIdentity: BuilderEvidenceFileIdentity;
  workspacePath: string;
  workspaceRealPath: string;
};

type HelperJsonValue =
  | string
  | number
  | boolean
  | null
  | HelperJsonValue[]
  | { [key: string]: HelperJsonValue | undefined };

export type BuilderEvidenceDirectoryEntry = {
  kind: "directory" | "file";
  name: string;
};

function identity(stats: Stats): BuilderEvidenceFileIdentity {
  return { dev: stats.dev, ino: stats.ino };
}

function fail(message: string): never {
  throw new Error(`Builder evidence filesystem: ${message}`);
}

function isJsonObject(
  value: HelperJsonValue,
): value is { [key: string]: HelperJsonValue | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeResponse(stdout: string): {
  content?: string;
  entries?: BuilderEvidenceDirectoryEntry[];
} {
  let value: HelperJsonValue;
  try {
    value = JSON.parse(stdout) as HelperJsonValue;
  } catch (cause) {
    throw new Error("Builder evidence filesystem helper returned invalid JSON", {
      cause,
    });
  }
  if (!isJsonObject(value)) {
    fail("helper returned an invalid response");
  }
  if (value.ok === false && typeof value.reason === "string") {
    fail(value.reason);
  }
  if (value.ok !== true) fail("helper returned an invalid response");

  const response: {
    content?: string;
    entries?: BuilderEvidenceDirectoryEntry[];
  } = {};
  if (typeof value.content === "string") response.content = value.content;
  if (Array.isArray(value.entries)) {
    const entries: BuilderEvidenceDirectoryEntry[] = [];
    for (const entry of value.entries) {
      if (
        !isJsonObject(entry) ||
        typeof entry.name !== "string" ||
        (entry.kind !== "directory" && entry.kind !== "file")
      ) {
        fail("helper returned an invalid directory entry");
      }
      entries.push({ name: entry.name, kind: entry.kind });
    }
    response.entries = entries;
  }
  return response;
}

function runHelper(
  source: string,
  cwd: string,
  request: BuilderEvidenceReadRequest | BuilderEvidenceListRequest | BuilderEvidenceProjectionRequest,
): ReturnType<typeof decodeResponse> {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", source],
    {
      cwd,
      encoding: "utf8",
      env: {},
      input: JSON.stringify(request),
      maxBuffer: HELPER_MAX_BUFFER,
      windowsHide: true,
    },
  );
  if (result.error !== undefined || result.status !== 0) {
    fail("isolated helper failed");
  }
  return decodeResponse(result.stdout);
}

function captureDirectoryAnchor(
  workspaceDir: string,
  directory: string,
): Pick<
  BuilderEvidenceReadRequest,
  | "ancestorIdentities"
  | "directoryPath"
  | "directoryRealPath"
  | "workspaceIdentity"
  | "workspacePath"
  | "workspaceRealPath"
> {
  const workspacePath = resolve(workspaceDir);
  const directoryPath = resolve(directory);
  if (!isBuilderPathInside(workspacePath, directoryPath)) {
    fail(`directory escaped the workspace: ${directoryPath}`);
  }
  const workspaceRealPath = realpathSync.native(workspacePath);
  const directoryRealPath = realpathSync.native(directoryPath);
  if (!isBuilderPathInside(workspaceRealPath, directoryRealPath)) {
    fail(`directory escaped the workspace: ${directoryPath}`);
  }

  const identities: BuilderEvidenceFileIdentity[] = [];
  let current = workspacePath;
  const parts = relative(workspacePath, directoryPath)
    .split(sep)
    .filter((part) => part.length > 0);
  for (const part of ["", ...parts]) {
    if (part.length > 0) current = resolve(current, part);
    const stats = lstatSync(current);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      fail(`directory chain must contain only real directories: ${current}`);
    }
    identities.push(identity(stats));
  }
  const workspaceIdentity = identities[0] ?? fail("workspace identity is missing");
  return {
    directoryPath,
    directoryRealPath,
    ancestorIdentities: identities.reverse(),
    workspaceIdentity,
    workspacePath,
    workspaceRealPath,
  };
}

export function captureBuilderEvidenceReadRequest(
  workspaceDir: string,
  absolutePath: string,
  maxBytes: number,
): BuilderEvidenceReadRequest {
  const path = resolve(absolutePath);
  const fileName = basename(path);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    fail("read byte limit is invalid");
  }
  return {
    operation: "read",
    ...captureDirectoryAnchor(workspaceDir, dirname(path)),
    fileName,
    maxBytes,
  };
}

export function readAnchoredBuilderEvidenceFile(
  request: BuilderEvidenceReadRequest,
): Buffer {
  const response = runHelper(
    EVIDENCE_READER_HELPER_SOURCE,
    request.directoryPath,
    request,
  );
  if (response.content === undefined) fail("helper omitted file content");
  return Buffer.from(response.content, "base64");
}

export function readStableBuilderEvidenceFile(
  workspaceDir: string,
  absolutePath: string,
  maxBytes: number,
): Buffer {
  return readAnchoredBuilderEvidenceFile(
    captureBuilderEvidenceReadRequest(workspaceDir, absolutePath, maxBytes),
  );
}

export function listStableBuilderEvidenceDirectory(
  workspaceDir: string,
  directory: string,
): BuilderEvidenceDirectoryEntry[] {
  const request: BuilderEvidenceListRequest = {
    operation: "list",
    ...captureDirectoryAnchor(workspaceDir, directory),
  };
  const response = runHelper(
    EVIDENCE_READER_HELPER_SOURCE,
    request.directoryPath,
    request,
  );
  if (response.entries === undefined) fail("helper omitted directory entries");
  return response.entries;
}

export function captureBuilderEvidenceProjectionRequest(
  workspaceDir: string,
  destination: string,
  content: Buffer,
): BuilderEvidenceProjectionRequest {
  const workspacePath = resolve(workspaceDir);
  const destinationPath = resolve(destination);
  if (!isBuilderPathInside(workspacePath, destinationPath)) {
    fail(`projection escaped the workspace: ${destinationPath}`);
  }
  const workspaceStats = lstatSync(workspacePath);
  if (workspaceStats.isSymbolicLink() || !workspaceStats.isDirectory()) {
    fail("workspace must be a real directory");
  }
  const directoryParts = relative(workspacePath, dirname(destinationPath))
    .split(sep)
    .filter((part) => part.length > 0);
  const fileName = basename(destinationPath);
  const existing = lstatSync(destinationPath, { throwIfNoEntry: false });
  if (
    existing !== undefined &&
    (existing.isSymbolicLink() || !existing.isFile() || existing.nlink !== 1)
  ) {
    fail("destination must be a private regular file");
  }
  return {
    content: content.toString("base64"),
    directoryParts,
    expectedDestinationIdentity: existing === undefined ? null : identity(existing),
    fileName,
    workspaceIdentity: identity(workspaceStats),
    workspacePath,
    workspaceRealPath: realpathSync.native(workspacePath),
  };
}

export function writeAnchoredBuilderEvidenceProjection(
  request: BuilderEvidenceProjectionRequest,
): void {
  runHelper(EVIDENCE_WRITER_HELPER_SOURCE, request.workspacePath, request);
}

export function writeStableBuilderEvidenceProjection(
  workspaceDir: string,
  destination: string,
  content: Buffer,
): void {
  writeAnchoredBuilderEvidenceProjection(
    captureBuilderEvidenceProjectionRequest(workspaceDir, destination, content),
  );
}
