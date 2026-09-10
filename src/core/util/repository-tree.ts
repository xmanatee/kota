import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { listAnchoredTextFiles } from "./filesystem/anchored-files.js";
import { withProtectedGitBareRepositoryEnv } from "./protected-git-env.js";

type TreeEntry = { name: string; kind: "file" | "directory" | "unsafe" };
export type RepositoryTextTree = {
  list(directory: string): TreeEntry[];
  read(path: string): string;
};

function pathParts(path: string): string[] {
  if (isAbsolute(path) || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Invalid repository-relative path: ${path}`);
  }
  return path.split("/");
}

export function readWorkingTextTree(root: string): RepositoryTextTree {
  const batches = new Map<string, Map<string, string> | Error>();
  return {
    list(directory) {
      const parts = pathParts(directory);
      for (let index = 0; index <= parts.length; index++) {
        const path = join(root, ...parts.slice(0, index));
        const stat = lstatSync(path, { throwIfNoEntry: false });
        if (!stat) return [];
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe repository directory: ${path}`);
      }
      return readdirSync(join(root, directory), { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "unsafe",
      }));
    },
    read(path) {
      pathParts(path);
      const directory = dirname(path);
      const suffix = extname(path) || null;
      const key = JSON.stringify([directory, suffix]);
      if (!batches.has(key)) {
        try {
          const entries = listAnchoredTextFiles({ rootPath: root, boundaryDir: root, directoryPath: join(root, directory), nameSuffix: suffix });
          batches.set(key, new Map(entries.map((entry) => [`${directory}/${entry.name}`, entry.content])));
        } catch (error) {
          batches.set(key, error instanceof Error ? error : new Error(String(error)));
        }
      }
      const batch = batches.get(key)!;
      if (batch instanceof Error) throw batch;
      const content = batch.get(path);
      if (content === undefined) throw new Error(`Repository file disappeared: ${path}`);
      return content;
    },
  };
}

/** Resolve object identities once, then read all selected blobs in one batch. Never writes the index. */
export function readGitTextTree(
  root: string,
  source: "HEAD" | "index",
  paths: readonly string[],
): { revision: string | null; tree: RepositoryTextTree } {
  for (const path of paths) pathParts(path);
  const git = (args: string[], input?: string) => execFileSync("git", args, {
    cwd: root,
    env: withProtectedGitBareRepositoryEnv(),
    input,
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let repositoryRoot: string;
  let revision: string | null;
  let listing: string;
  try {
    repositoryRoot = git(["rev-parse", "--show-toplevel"]).toString("utf8").trim();
    revision = source === "HEAD" ? git(["rev-parse", "--verify", "HEAD^{commit}"]).toString("utf8").trim() : null;
    listing = git(revision
      ? ["ls-tree", "-r", "-z", "--full-tree", revision]
      : ["-C", repositoryRoot, "ls-files", "--stage", "-z", "--full-name"]).toString("utf8");
  } catch (error) {
    throw new Error(`Cannot read repository ${source} snapshot at ${root}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const prefix = relative(realpathSync(repositoryRoot), realpathSync(resolve(root))).split(sep).filter(Boolean).join("/");
  const scopedPaths = paths.map((path) => prefix ? `${prefix}/${path}` : path);
  const selected = listing.split("\0").filter(Boolean).flatMap((line) => {
    const separator = line.indexOf("\t");
    if (separator < 0) throw new Error("Malformed Git tree entry");
    const path = line.slice(separator + 1);
    if (!scopedPaths.some((selectedPath) => path === selectedPath || path.startsWith(`${selectedPath}/`) || selectedPath.startsWith(`${path}/`))) return [];
    const [mode, second, third] = line.slice(0, separator).split(" ");
    if (source === "index" && third !== "0") throw new Error(`Unmerged index entry: ${path}`);
    return [{ path, mode, oid: source === "index" ? second : third }];
  });
  const files = selected.filter(({ mode }) => mode === "100644" || mode === "100755");
  const blobs = files.length ? git(["cat-file", "--batch"], `${files.map(({ oid }) => oid).join("\n")}\n`) : Buffer.alloc(0);
  const contentByPath = new Map<string, string>();
  let offset = 0;
  for (const file of files) {
    const end = blobs.indexOf(10, offset);
    const [oid, type, sizeText] = blobs.subarray(offset, end).toString("utf8").split(" ");
    const size = Number(sizeText);
    if (end < offset || oid !== file.oid || type !== "blob" || !Number.isSafeInteger(size) || size < 0 || end + size + 1 >= blobs.length) {
      throw new Error(`Invalid Git blob response for ${file.path}`);
    }
    contentByPath.set(file.path, blobs.subarray(end + 1, end + 1 + size).toString("utf8"));
    offset = end + size + 2;
  }
  const kinds = new Map<string, TreeEntry["kind"]>();
  for (const file of selected) {
    kinds.set(file.path, contentByPath.has(file.path) ? "file" : "unsafe");
    for (let parent = dirname(file.path); parent !== "."; parent = dirname(parent)) {
      if (!kinds.has(parent)) kinds.set(parent, "directory");
    }
  }
  const scoped = (path: string) => {
    pathParts(path);
    return prefix ? `${prefix}/${path}` : path;
  };
  return { revision, tree: {
    list(directory) {
      const full = scoped(directory);
      for (let parent = full; parent !== "."; parent = dirname(parent)) {
        const kind = kinds.get(parent);
        if (kind !== undefined && kind !== "directory") throw new Error(`Unsafe repository directory: ${parent}`);
      }
      return [...kinds].filter(([path]) => dirname(path) === full).map(([path, kind]) => ({ name: path.slice(full.length + 1), kind }));
    },
    read(path) {
      const content = contentByPath.get(scoped(path));
      if (content === undefined) throw new Error(`Not a regular repository file: ${path}`);
      return content;
    },
  } };
}
