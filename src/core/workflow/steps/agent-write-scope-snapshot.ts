import { execFileSync, spawnSync } from "node:child_process";
import { createHash, type Hash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import {
  diffMutatedPaths,
  listWorkflowMutatedPaths,
  tryListWorkflowMutatedPaths,
} from "./agent-write-scope.js";

type FileSystemPathSnapshot =
  | { kind: "absent" }
  | { kind: "file"; mode: number; content: Buffer }
  | { kind: "symlink"; target: string }
  | {
      kind: "directory";
      mode: number;
      entries: readonly (readonly [string, FileSystemPathSnapshot])[];
    };

type MutationPathSnapshot = {
  fingerprint: string;
  indexEntries: Buffer;
  fileSystem: FileSystemPathSnapshot;
};

function gitBuffer(workspaceRoot: string, args: readonly string[]): Buffer {
  return execFileSync("git", [...args], {
    cwd: workspaceRoot,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function absoluteMutationPath(workspaceRoot: string, path: string): string {
  const root = resolve(workspaceRoot);
  const absolutePath = resolve(root, path);
  const relativePath = relative(root, absolutePath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Refusing to snapshot an invalid agent mutation path: ${path}`);
  }
  return absolutePath;
}

function captureFileSystemPath(path: string): FileSystemPathSnapshot {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined) return { kind: "absent" };
  if (stat.isSymbolicLink()) {
    return { kind: "symlink", target: readlinkSync(path) };
  }
  if (stat.isFile()) {
    return {
      kind: "file",
      mode: stat.mode & 0o777,
      content: readFileSync(path),
    };
  }
  if (stat.isDirectory()) {
    return {
      kind: "directory",
      mode: stat.mode & 0o777,
      entries: readdirSync(path)
        .sort()
        .map((name) => [name, captureFileSystemPath(join(path, name))] as const),
    };
  }
  throw new Error(`Cannot snapshot unsupported repository path type: ${path}`);
}

function updateFileSystemFingerprint(
  hash: Hash,
  snapshot: FileSystemPathSnapshot,
): void {
  hash.update(snapshot.kind);
  hash.update("\0");
  if (snapshot.kind === "absent") return;
  if (snapshot.kind === "symlink") {
    hash.update(snapshot.target);
    return;
  }
  hash.update(String(snapshot.mode));
  hash.update("\0");
  if (snapshot.kind === "file") {
    hash.update(snapshot.content);
    return;
  }
  for (const [name, child] of snapshot.entries) {
    hash.update(name);
    hash.update("\0");
    updateFileSystemFingerprint(hash, child);
  }
}

function captureMutationPath(
  workspaceRoot: string,
  path: string,
): MutationPathSnapshot {
  const indexEntries = gitBuffer(workspaceRoot, [
    "--literal-pathspecs",
    "ls-files",
    "--stage",
    "-z",
    "--",
    path,
  ]);
  const fileSystem = captureFileSystemPath(
    absoluteMutationPath(workspaceRoot, path),
  );
  const hash = createHash("sha256");
  hash.update(indexEntries);
  hash.update("\0");
  updateFileSystemFingerprint(hash, fileSystem);
  return {
    fingerprint: hash.digest("hex"),
    indexEntries,
    fileSystem,
  };
}

function pathExistsInHead(workspaceRoot: string, path: string): boolean {
  const result = spawnSync(
    "git",
    ["--literal-pathspecs", "cat-file", "-e", `HEAD:${path}`],
    {
      cwd: workspaceRoot,
      env: withProtectedGitBareRepositoryEnv(),
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
    },
  );
  if (result.error !== undefined) throw result.error;
  return result.status === 0;
}

function restoreFileSystemPath(
  path: string,
  snapshot: FileSystemPathSnapshot,
): void {
  rmSync(path, { recursive: true, force: true });
  if (snapshot.kind === "absent") return;
  mkdirSync(dirname(path), { recursive: true });
  if (snapshot.kind === "symlink") {
    symlinkSync(snapshot.target, path);
    return;
  }
  if (snapshot.kind === "file") {
    writeFileSync(path, snapshot.content);
    chmodSync(path, snapshot.mode);
    return;
  }
  mkdirSync(path, { recursive: true });
  for (const [name, child] of snapshot.entries) {
    restoreFileSystemPath(join(path, name), child);
  }
  chmodSync(path, snapshot.mode);
}

function restoreIndexPath(
  workspaceRoot: string,
  path: string,
  indexEntries: Buffer,
): void {
  execFileSync(
    "git",
    ["--literal-pathspecs", "update-index", "--force-remove", "--", path],
    {
      cwd: workspaceRoot,
      env: withProtectedGitBareRepositoryEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (indexEntries.length === 0) return;
  execFileSync("git", ["update-index", "-z", "--index-info"], {
    cwd: workspaceRoot,
    env: withProtectedGitBareRepositoryEnv(),
    input: indexEntries,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export class WorkflowMutationSnapshot {
  constructor(
    readonly mutatedPaths: readonly string[],
    private readonly pathSnapshots: ReadonlyMap<string, MutationPathSnapshot>,
  ) {}

  changedPathsSince(post: WorkflowMutationSnapshot): string[] {
    const changed = new Set(
      diffMutatedPaths(this.mutatedPaths, post.mutatedPaths),
    );
    for (const path of this.mutatedPaths) {
      const before = this.pathSnapshots.get(path);
      const after = post.pathSnapshots.get(path);
      if (before?.fingerprint !== after?.fingerprint) changed.add(path);
    }
    return [...changed].sort();
  }

  restoreDenyAllMutations(
    workspaceRoot: string,
    paths: readonly string[],
  ): void {
    if (paths.length === 0) return;
    const preExistingDirty = paths.filter((path) =>
      this.pathSnapshots.has(path)
    );
    const newTracked = paths.filter((path) =>
      !this.pathSnapshots.has(path) && pathExistsInHead(workspaceRoot, path)
    );
    const newUntracked = paths.filter((path) =>
      !this.pathSnapshots.has(path) && !newTracked.includes(path)
    );

    if (newTracked.length > 0) {
      execFileSync(
        "git",
        [
          "--literal-pathspecs",
          "restore",
          "--source=HEAD",
          "--staged",
          "--worktree",
          "--",
          ...newTracked,
        ],
        {
          cwd: workspaceRoot,
          env: withProtectedGitBareRepositoryEnv(),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    }
    for (const path of newUntracked) {
      restoreIndexPath(workspaceRoot, path, Buffer.alloc(0));
      rmSync(absoluteMutationPath(workspaceRoot, path), {
        recursive: true,
        force: true,
      });
    }
    for (const path of preExistingDirty) {
      const snapshot = this.pathSnapshots.get(path);
      if (snapshot === undefined) continue;
      restoreIndexPath(workspaceRoot, path, snapshot.indexEntries);
      restoreFileSystemPath(
        absoluteMutationPath(workspaceRoot, path),
        snapshot.fileSystem,
      );
    }
  }
}

function captureSnapshotForPaths(
  workspaceRoot: string,
  mutatedPaths: readonly string[],
): WorkflowMutationSnapshot {
  return new WorkflowMutationSnapshot(
    [...mutatedPaths],
    new Map(
      mutatedPaths.map((path) => [
        path,
        captureMutationPath(workspaceRoot, path),
      ]),
    ),
  );
}

export function captureWorkflowMutationSnapshot(
  workspaceRoot: string,
): WorkflowMutationSnapshot {
  return captureSnapshotForPaths(
    workspaceRoot,
    listWorkflowMutatedPaths(workspaceRoot),
  );
}

export function tryCaptureWorkflowMutationSnapshot(
  workspaceRoot: string,
): WorkflowMutationSnapshot | undefined {
  const mutatedPaths = tryListWorkflowMutatedPaths(workspaceRoot);
  return mutatedPaths === undefined
    ? undefined
    : captureSnapshotForPaths(workspaceRoot, mutatedPaths);
}
