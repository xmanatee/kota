import { lstatSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

export type WorkspaceWriteProtection = {
  path: string;
  kind: "file" | "tree";
};

type LinkedInode = {
  kind: LinkedInodeKind;
  linkCount: bigint;
  paths: string[];
};

export type LinkedInodeKind =
  | "regular file"
  | "FIFO"
  | "socket"
  | "symbolic link"
  | "block device"
  | "character device"
  | "special file";

type LinkedInodeStat = {
  isFile(): boolean;
  isFIFO(): boolean;
  isSocket(): boolean;
  isSymbolicLink(): boolean;
  isBlockDevice(): boolean;
  isCharacterDevice(): boolean;
};

export function classifyTaskProbeLinkedInode(
  stat: LinkedInodeStat,
): LinkedInodeKind {
  if (stat.isFile()) return "regular file";
  if (stat.isFIFO()) return "FIFO";
  if (stat.isSocket()) return "socket";
  if (stat.isSymbolicLink()) return "symbolic link";
  if (stat.isBlockDevice()) return "block device";
  if (stat.isCharacterDevice()) return "character device";
  return "special file";
}

function collectLinkedInodes(
  directory: string,
  linkedInodes: Map<string, LinkedInode>,
): void {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = lstatSync(path, { bigint: true });
    if (stat.isDirectory()) {
      collectLinkedInodes(path, linkedInodes);
      continue;
    }
    const kind = classifyTaskProbeLinkedInode(stat);
    if (kind !== "regular file" && kind !== "symbolic link") {
      throw new Error(
        `Runtime Probe workspace contains a ${kind} at ${path}; refusing execution because pathname IPC and device inodes remain connected to the host across namespace boundaries.`,
      );
    }
    if (stat.nlink <= 1n) continue;

    const key = `${stat.dev}:${stat.ino}`;
    const inode = linkedInodes.get(key);
    if (inode === undefined) {
      linkedInodes.set(key, { kind, linkCount: stat.nlink, paths: [path] });
    } else {
      inode.linkCount =
        inode.linkCount > stat.nlink ? inode.linkCount : stat.nlink;
      inode.paths.push(path);
    }
  }
}

function protectionForPath(
  workspaceDir: string,
  path: string,
): WorkspaceWriteProtection {
  const workspacePath = relative(workspaceDir, path);
  if (
    workspacePath === "" ||
    workspacePath === ".." ||
    workspacePath.startsWith(`..${sep}`) ||
    isAbsolute(workspacePath)
  ) {
    throw new Error(`Hard-linked path escaped Runtime Probe workspace: ${path}`);
  }
  const [topLevelEntry, ...rest] = workspacePath.split(sep);
  return rest.length === 0
    ? { path, kind: "file" }
    : { path: join(workspaceDir, topLevelEntry), kind: "tree" };
}

/**
 * Returns regular-file workspace entries that contain an inode with at least
 * one name outside the workspace. Freezing the top-level tree also bounds
 * native sandbox policy size for package stores that materialize many hard
 * links. Every pathname IPC or device inode rejects the probe regardless of
 * link count because namespace isolation does not sever its live host-side
 * effects. Ordinary symlinks remain safe under the sandbox's empty root.
 */
export function findExternalHardLinkWriteProtections(
  workspaceDir: string,
): WorkspaceWriteProtection[] {
  const linkedInodes = new Map<string, LinkedInode>();
  collectLinkedInodes(workspaceDir, linkedInodes);

  const protections = new Map<string, WorkspaceWriteProtection>();
  for (const inode of linkedInodes.values()) {
    if (BigInt(inode.paths.length) === inode.linkCount) continue;
    if (inode.kind !== "regular file") {
      throw new Error(
        `Runtime Probe workspace contains an externally linked ${inode.kind} at ${inode.paths[0]}; refusing execution because write-only filesystem policy cannot contain host IPC or special-inode effects.`,
      );
    }
    for (const path of inode.paths) {
      const protection = protectionForPath(workspaceDir, path);
      protections.set(protection.path, protection);
    }
  }
  return [...protections.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}
