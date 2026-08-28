import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { basename, dirname, join, parse, resolve, sep } from "node:path";
import { OWNER_DECISION_RECORD_STORAGE_HELPER_SOURCE } from "./owner-decision-record-storage-helper-source.js";

const DIRECTORY_MODE = 0o700;
const HELPER_MAX_BUFFER = 16 * 1024 * 1024;
const RECORD_PATTERN = /^[0-9a-f]{8}\.json$/;

export type OwnerDecisionFileIdentity = {
  dev: number;
  ino: number;
};

export type OwnerDecisionRecordSnapshot = {
  filename: string;
  contents: string;
  identity: OwnerDecisionFileIdentity;
};

type HelperRequest = {
  operation: "read" | "list" | "write" | "clear";
  directoryPath: string;
  directoryIdentity: OwnerDecisionFileIdentity;
  filename?: string;
  contents?: string;
  expectedIdentity?: OwnerDecisionFileIdentity | null;
};

type HelperSnapshot =
  | { exists: false }
  | { exists: true; contents: string; identity: OwnerDecisionFileIdentity };

type HelperResponse =
  | {
      ok: true;
      snapshot?: HelperSnapshot;
      snapshots?: Array<HelperSnapshot & { filename: string }>;
      identity?: OwnerDecisionFileIdentity;
    }
  | { ok: false; reason: string };

function identity(stats: Stats): OwnerDecisionFileIdentity {
  return { dev: stats.dev, ino: stats.ino };
}

function sameFile(left: OwnerDecisionFileIdentity, right: OwnerDecisionFileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function storageError(path: string, reason: string): Error {
  return new Error(`Refusing to access owner decision storage at ${path}: ${reason}`);
}

function lstatOptional(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function directoryComponents(path: string): string[] {
  const root = parse(path).root;
  const paths: string[] = [];
  let current = root;
  for (const component of path.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, component);
    paths.push(current);
  }
  return paths;
}

function canonicalizeOwnerDecisionDirectoryPath(path: string): string {
  const requestedPath = resolve(path);
  const root = parse(requestedPath).root;
  if (requestedPath === root) {
    throw storageError(requestedPath, "owner decision directory cannot be the filesystem root");
  }

  const missingParents: string[] = [];
  let existingParent = dirname(requestedPath);
  while (lstatOptional(existingParent) === undefined) {
    missingParents.unshift(basename(existingParent));
    existingParent = dirname(existingParent);
  }

  return join(
    realpathSync.native(existingParent),
    ...missingParents,
    basename(requestedPath),
  );
}

function requireDaemonOwner(stats: Stats, path: string): void {
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    throw storageError(path, "owner decision directory must be owned by the daemon user");
  }
}

function prepareOwnerDecisionDirectory(path: string): OwnerDecisionFileIdentity {
  if (!Number.isInteger(constants.O_NOFOLLOW) || constants.O_NOFOLLOW === 0) {
    throw storageError(path, "this platform cannot enforce no-follow owner decision storage");
  }
  for (const componentPath of directoryComponents(path)) {
    let stats = lstatOptional(componentPath);
    if (stats === undefined) {
      mkdirSync(componentPath, { mode: DIRECTORY_MODE });
      stats = lstatSync(componentPath);
    }
    if (stats.isSymbolicLink()) {
      throw storageError(path, `owner decision directory must not contain symbolic links (${componentPath})`);
    }
    if (!stats.isDirectory()) {
      throw storageError(path, `owner decision directory path component is not a directory (${componentPath})`);
    }
  }
  if (realpathSync.native(path) !== path) {
    throw storageError(path, "owner decision directory must resolve to its intended path");
  }

  const pathStats = lstatSync(path);
  requireDaemonOwner(pathStats, path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const openedStats = fstatSync(fd);
    requireDaemonOwner(openedStats, path);
    if (!openedStats.isDirectory() || !sameFile(identity(pathStats), identity(openedStats))) {
      throw storageError(path, "owner decision directory changed while it was opened");
    }
    fchmodSync(fd, DIRECTORY_MODE);
    return identity(openedStats);
  } finally {
    closeSync(fd);
  }
}

export class OwnerDecisionRecordStorage {
  readonly directoryPath: string;
  private readonly directoryIdentity: OwnerDecisionFileIdentity;

  constructor(path: string) {
    this.directoryPath = canonicalizeOwnerDecisionDirectoryPath(path);
    this.directoryIdentity = prepareOwnerDecisionDirectory(this.directoryPath);
  }

  read(filename: string): OwnerDecisionRecordSnapshot | null {
    this.assertRecordFilename(filename);
    const response = this.run({
      operation: "read",
      filename,
    });
    if (response.snapshot === undefined) {
      throw storageError(this.directoryPath, "filesystem helper omitted the snapshot");
    }
    if (!response.snapshot.exists) return null;
    return {
      filename,
      contents: response.snapshot.contents,
      identity: response.snapshot.identity,
    };
  }

  list(): OwnerDecisionRecordSnapshot[] {
    const response = this.run({
      operation: "list",
    });
    if (response.snapshots === undefined) {
      throw storageError(this.directoryPath, "filesystem helper omitted the snapshots");
    }
    return response.snapshots.flatMap((snapshot) =>
      snapshot.exists
        ? [
            {
              filename: snapshot.filename,
              contents: snapshot.contents,
              identity: snapshot.identity,
            },
          ]
        : [],
    );
  }

  write(
    filename: string,
    contents: string,
    expectedIdentity?: OwnerDecisionFileIdentity | null,
  ): OwnerDecisionFileIdentity {
    this.assertRecordFilename(filename);
    const response = this.run({
      operation: "write",
      filename,
      contents,
      ...(expectedIdentity !== undefined ? { expectedIdentity } : {}),
    });
    if (!response.identity) {
      throw storageError(this.directoryPath, "helper did not return record identity");
    }
    return response.identity;
  }

  clear(): void {
    this.run({
      operation: "clear",
    });
  }

  private assertRecordFilename(filename: string): void {
    if (!RECORD_PATTERN.test(filename)) {
      throw storageError(
        join(this.directoryPath, filename),
        `malformed record filename: ${filename}`,
      );
    }
  }

  private run(
    request: Omit<HelperRequest, "directoryPath" | "directoryIdentity">,
  ): Extract<HelperResponse, { ok: true }> {
    const child = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", OWNER_DECISION_RECORD_STORAGE_HELPER_SOURCE],
      {
        input: JSON.stringify({
          ...request,
          directoryPath: this.directoryPath,
          directoryIdentity: this.directoryIdentity,
        }),
        encoding: "utf8",
        env: {},
        maxBuffer: HELPER_MAX_BUFFER,
        windowsHide: true,
      },
    );

    if (child.error) {
      throw storageError(this.directoryPath, child.error.message);
    }
    if (child.status !== 0) {
      const stderr = child.stderr?.trim() || `exit code ${child.status}`;
      throw storageError(this.directoryPath, stderr);
    }

    try {
      const response = JSON.parse(child.stdout) as HelperResponse;
      if (!response.ok) {
        throw storageError(this.directoryPath, response.reason);
      }
      return response as Extract<HelperResponse, { ok: true }>;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Refusing to access owner decision storage")) {
        throw error;
      }
      throw storageError(this.directoryPath, `invalid helper response: ${child.stdout}`);
    }
  }
}
