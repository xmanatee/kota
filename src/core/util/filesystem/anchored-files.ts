import { spawn, spawnSync } from "node:child_process";
import { constants, lstatSync, realpathSync, type Stats } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ANCHORED_FILE_HELPER_SOURCE } from "./anchored-file-helper-source.js";
import {
  type AnchoredBatchEntry,
  type BatchReadRequest,
  type FileAccess,
  type FileIdentity,
  type FileSnapshot,
  type HelperRequest,
  helperResponseSchema,
  type MutationExpectation,
  type PreparedDirectory,
  unsafeFilesystemPath,
  type VerifiedDirectoryEntry,
  type VerifiedFile,
} from "./anchored-file-protocol.js";

const HELPER_MAX_BUFFER = 64 * 1024 * 1024;

function identity(stats: Stats): FileIdentity {
  return { dev: stats.dev, ino: stats.ino };
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function relativePathInside(rootDir: string, targetPath: string): string {
  const relativePath = relative(resolve(rootDir), resolve(targetPath));
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw unsafeFilesystemPath(targetPath, `path must be inside ${rootDir}`);
  }
  return relativePath;
}

function prepareDirectory(args: {
  rootPath: string;
  boundaryDir: string;
  directoryPath: string;
  createParent: boolean;
}): PreparedDirectory {
  if (
    !Number.isInteger(constants.O_DIRECTORY) ||
    constants.O_DIRECTORY === 0 ||
    !Number.isInteger(constants.O_NOFOLLOW) ||
    constants.O_NOFOLLOW === 0
  ) {
    throw unsafeFilesystemPath(
      args.directoryPath,
      "this platform cannot enforce descriptor-anchored filesystem access",
    );
  }
  relativePathInside(args.boundaryDir, args.directoryPath);

  const logicalRoot = resolve(args.rootPath);
  relativePathInside(logicalRoot, args.boundaryDir);
  const relativeDirectory = relativePathInside(logicalRoot, args.directoryPath);
  const logicalStats = lstatSync(logicalRoot);
  if (logicalStats.isSymbolicLink()) {
    throw unsafeFilesystemPath(logicalRoot, "symbolic-link filesystem roots are forbidden");
  }
  if (!logicalStats.isDirectory()) {
    throw unsafeFilesystemPath(logicalRoot, "filesystem root must be a directory");
  }
  const rootPath = realpathSync.native(logicalRoot);
  const canonicalStats = lstatSync(rootPath);
  if (
    !canonicalStats.isDirectory() ||
    !sameFileIdentity(identity(logicalStats), identity(canonicalStats))
  ) {
    throw unsafeFilesystemPath(logicalRoot, "filesystem root identity changed during canonicalization");
  }

  const parentPath = join(rootPath, relativeDirectory);
  return {
    createParent: args.createParent,
    parentParts: relative(rootPath, parentPath).split(sep).filter((part) => part.length > 0),
    parentPath,
    rootIdentity: identity(canonicalStats),
    rootPath,
  };
}

function prepareFile(args: FileAccess, createParent: boolean): PreparedDirectory & { fileName: string } {
  if (relativePathInside(args.boundaryDir, args.filePath).length === 0) {
    throw unsafeFilesystemPath(args.filePath, "file path must name an entry inside the allowed directory");
  }
  return {
    ...prepareDirectory({
      rootPath: args.rootPath,
      boundaryDir: args.boundaryDir,
      directoryPath: dirname(resolve(args.filePath)),
      createParent,
    }),
    fileName: basename(resolve(args.filePath)),
  };
}

function runHelper(request: HelperRequest, displayPath: string) {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", ANCHORED_FILE_HELPER_SOURCE],
    {
      encoding: "utf8",
      env: {},
      input: JSON.stringify(request),
      maxBuffer: HELPER_MAX_BUFFER,
      windowsHide: true,
    },
  );
  if (result.error !== undefined || result.status !== 0) {
    throw unsafeFilesystemPath(displayPath, "isolated filesystem helper failed");
  }
  let response: ReturnType<typeof helperResponseSchema.parse>;
  try {
    response = helperResponseSchema.parse(JSON.parse(result.stdout));
  } catch {
    throw unsafeFilesystemPath(displayPath, "isolated filesystem helper returned invalid data");
  }
  if (!response.ok) throw unsafeFilesystemPath(displayPath, response.reason);
  return response;
}

export function readAnchoredTextFile(args: FileAccess): VerifiedFile | null {
  const response = runHelper({ operation: "read", ...prepareFile(args, false) }, args.filePath);
  if (response.snapshot === undefined) {
    throw unsafeFilesystemPath(args.filePath, "helper omitted the file snapshot");
  }
  if (!response.snapshot.exists) return null;
  return { content: response.snapshot.content, snapshot: response.snapshot.snapshot };
}

export function listAnchoredTextFiles(args: {
  rootPath: string;
  boundaryDir: string;
  directoryPath: string;
  nameSuffix: string | null;
}): VerifiedDirectoryEntry[] {
  const response = runHelper(
    {
      operation: "list",
      ...prepareDirectory({ ...args, createParent: false }),
      nameSuffix: args.nameSuffix,
    },
    args.directoryPath,
  );
  if (response.entries === undefined) {
    throw unsafeFilesystemPath(args.directoryPath, "helper omitted the directory entries");
  }
  return response.entries;
}

export function writeAnchoredTextFile(
  args: FileAccess & { content: string } & MutationExpectation,
): FileSnapshot {
  const response = runHelper(
    {
      operation: "write",
      ...prepareFile(args, true),
      content: args.content,
      ...(args.expectation === "existing"
        ? { expectation: args.expectation, expectedSnapshot: args.expectedSnapshot }
        : { expectation: args.expectation }),
    },
    args.filePath,
  );
  if (response.installedSnapshot === undefined) {
    throw unsafeFilesystemPath(args.filePath, "helper omitted the installed file snapshot");
  }
  return response.installedSnapshot;
}

export function removeAnchoredTextFile(args: FileAccess & { expectedSnapshot: FileSnapshot }): void {
  const response = runHelper(
    { operation: "remove", ...prepareFile(args, false), expectedSnapshot: args.expectedSnapshot },
    args.filePath,
  );
  if (response.removed !== true) {
    throw unsafeFilesystemPath(args.filePath, "helper omitted the removal result");
  }
}

/** Bounded independent reads share one isolated helper and retain per-file failures. */
export async function readAnchoredTextFiles(
  files: readonly (FileAccess & { maxBytes: number })[],
  signal?: AbortSignal,
): Promise<AnchoredBatchEntry[]> {
  if (files.length > 64) throw new Error("Anchored read batch exceeds 64 files");
  if (files.length === 0) return [];
  const entries: AnchoredBatchEntry[] = [];
  const selected: number[] = [];
  const request: BatchReadRequest = { operation: "read-batch", requests: [] };
  for (const [index, file] of files.entries()) {
    try {
      request.requests.push({ ...prepareFile(file, false), operation: "read", maxBytes: file.maxBytes });
      selected.push(index);
    } catch (error) {
      entries[index] = { ok: false, reason: error instanceof Error ? error.message : "Unsafe file access" };
    }
  }
  if (selected.length === 0) return entries;
  signal?.throwIfAborted();
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", ANCHORED_FILE_HELPER_SOURCE], {
      env: {}, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let failure: Error | undefined;
    const abort = () => { failure = new Error("Anchored read aborted"); child.kill("SIGKILL"); };
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > HELPER_MAX_BUFFER) { failure = new Error("Anchored read output exceeds limit"); child.kill("SIGKILL"); }
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.stdin.on("error", (error: Error) => { failure ??= error; });
    child.on("error", (error) => { failure = error; });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (failure || code !== 0) reject(failure ?? new Error("Anchored read helper failed"));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    child.stdin.end(JSON.stringify(request));
    if (signal?.aborted) abort();
  });
  const response = helperResponseSchema.parse(JSON.parse(output));
  if (!response.ok) throw new Error(response.reason);
  if (response.files?.length !== selected.length) throw new Error("Anchored batch omitted file results");
  for (const [index, file] of response.files.entries()) entries[selected[index]!] = file;
  return entries;
}
