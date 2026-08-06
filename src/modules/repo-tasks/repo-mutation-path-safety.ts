import { spawnSync } from "node:child_process";
import { constants, lstatSync, realpathSync, type Stats } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { REPO_MUTATION_FILESYSTEM_HELPER_SOURCE } from "./repo-mutation-filesystem-helper-source.js";

const HELPER_MAX_BUFFER = 64 * 1024 * 1024;

export type FileIdentity = {
  dev: number;
  ino: number;
};

export type FileSnapshot = FileIdentity & {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
};

export type VerifiedFile = {
  content: string;
  snapshot: FileSnapshot;
};

type MutationExpectation =
  | { expectation: "any" }
  | { expectation: "missing" }
  | { expectation: "existing"; expectedSnapshot: FileSnapshot };

type PreparedPath = {
  createParent: boolean;
  fileName: string;
  parentParts: string[];
  parentPath: string;
  projectRootIdentity: FileIdentity;
  projectRootPath: string;
};

type HelperRequest = PreparedPath &
  (
    | { operation: "read" }
    | ({ operation: "write"; content: string } & MutationExpectation)
    | { operation: "remove"; expectedSnapshot: FileSnapshot }
  );

type HelperResponse =
  | {
      ok: true;
      snapshot?:
        | { exists: false }
        | { exists: true; content: string; snapshot: FileSnapshot };
      installedSnapshot?: FileSnapshot;
      removed?: boolean;
    }
  | { ok: false; reason: string };

function identity(stats: Stats): FileIdentity {
  return { dev: stats.dev, ino: stats.ino };
}

export function sameFileIdentity(
  left: FileIdentity,
  right: FileIdentity,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

export function unsafeRepoMutationPath(path: string, reason: string): Error {
  return new Error(`Unsafe repo mutation path ${path}: ${reason}`);
}

function relativePathInside(rootDir: string, targetPath: string): string {
  const relativePath = relative(resolve(rootDir), resolve(targetPath));
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Repo mutation path must be inside ${rootDir}: ${targetPath}`);
  }
  return relativePath;
}

function requireMarkdownPathInside(rootDir: string, filePath: string): void {
  const relativePath = relativePathInside(rootDir, filePath);
  if (relativePath.length === 0) {
    throw new Error(`Repo mutation path must be inside ${rootDir}: ${filePath}`);
  }
  if (!relativePath.endsWith(".md")) {
    throw new Error(`Repo mutation path must name a markdown file: ${filePath}`);
  }
}

function preparePath(args: {
  projectDir: string;
  rootDir: string;
  filePath: string;
  createParent: boolean;
}): PreparedPath {
  if (
    !Number.isInteger(constants.O_DIRECTORY) ||
    constants.O_DIRECTORY === 0 ||
    !Number.isInteger(constants.O_NOFOLLOW) ||
    constants.O_NOFOLLOW === 0
  ) {
    throw unsafeRepoMutationPath(
      args.filePath,
      "this platform cannot enforce descriptor-anchored mutations",
    );
  }
  requireMarkdownPathInside(args.rootDir, args.filePath);

  const logicalRoot = resolve(args.projectDir);
  relativePathInside(logicalRoot, args.rootDir);
  const relativeFile = relativePathInside(logicalRoot, args.filePath);
  const logicalStats = lstatSync(logicalRoot);
  if (logicalStats.isSymbolicLink()) {
    throw unsafeRepoMutationPath(
      logicalRoot,
      "symbolic-link project roots are forbidden",
    );
  }
  if (!logicalStats.isDirectory()) {
    throw unsafeRepoMutationPath(logicalRoot, "project root must be a directory");
  }
  const projectRootPath = realpathSync.native(logicalRoot);
  const canonicalStats = lstatSync(projectRootPath);
  if (
    !canonicalStats.isDirectory() ||
    !sameFileIdentity(identity(logicalStats), identity(canonicalStats))
  ) {
    throw unsafeRepoMutationPath(
      logicalRoot,
      "project root identity changed during canonicalization",
    );
  }

  const canonicalFilePath = join(projectRootPath, relativeFile);
  const parentPath = dirname(canonicalFilePath);
  const parentParts = relative(projectRootPath, parentPath)
    .split(sep)
    .filter((part) => part.length > 0);
  return {
    createParent: args.createParent,
    fileName: basename(canonicalFilePath),
    parentParts,
    parentPath,
    projectRootIdentity: identity(canonicalStats),
    projectRootPath,
  };
}

function runHelper(
  request: HelperRequest,
  displayPath: string,
): Extract<HelperResponse, { ok: true }> {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", REPO_MUTATION_FILESYSTEM_HELPER_SOURCE],
    {
      encoding: "utf8",
      env: {},
      input: JSON.stringify(request),
      maxBuffer: HELPER_MAX_BUFFER,
      windowsHide: true,
    },
  );
  if (result.error !== undefined || result.status !== 0) {
    throw unsafeRepoMutationPath(displayPath, "isolated filesystem helper failed");
  }
  let response: HelperResponse;
  try {
    response = JSON.parse(result.stdout) as HelperResponse;
  } catch {
    throw unsafeRepoMutationPath(
      displayPath,
      "isolated filesystem helper returned invalid data",
    );
  }
  if (!response.ok) {
    throw unsafeRepoMutationPath(displayPath, response.reason);
  }
  return response;
}

export function readVerifiedRepoMarkdownFileWithIdentity(args: {
  projectDir: string;
  rootDir: string;
  filePath: string;
}): VerifiedFile | null {
  const response = runHelper(
    {
      operation: "read",
      ...preparePath({ ...args, createParent: false }),
    },
    args.filePath,
  );
  if (response.snapshot === undefined) {
    throw unsafeRepoMutationPath(args.filePath, "helper omitted the file snapshot");
  }
  if (!response.snapshot.exists) return null;
  return {
    content: response.snapshot.content,
    snapshot: response.snapshot.snapshot,
  };
}

export function readVerifiedRepoMarkdownFile(args: {
  projectDir: string;
  rootDir: string;
  filePath: string;
}): string | null {
  return readVerifiedRepoMarkdownFileWithIdentity(args)?.content ?? null;
}

export function writeAnchoredRepoMarkdownFile(
  args: {
    projectDir: string;
    rootDir: string;
    filePath: string;
    content: string;
  } & MutationExpectation,
): FileSnapshot {
  const response = runHelper(
    {
      operation: "write",
      ...preparePath({ ...args, createParent: true }),
      content: args.content,
      ...(args.expectation === "existing"
        ? {
            expectation: args.expectation,
            expectedSnapshot: args.expectedSnapshot,
          }
        : { expectation: args.expectation }),
    },
    args.filePath,
  );
  if (response.installedSnapshot === undefined) {
    throw unsafeRepoMutationPath(
      args.filePath,
      "helper omitted the installed file snapshot",
    );
  }
  return response.installedSnapshot;
}

export function removeAnchoredRepoMarkdownFile(args: {
  projectDir: string;
  rootDir: string;
  filePath: string;
  expectedSnapshot: FileSnapshot;
}): void {
  const response = runHelper(
    {
      operation: "remove",
      ...preparePath({ ...args, createParent: false }),
      expectedSnapshot: args.expectedSnapshot,
    },
    args.filePath,
  );
  if (response.removed !== true) {
    throw unsafeRepoMutationPath(args.filePath, "helper omitted the removal result");
  }
}
