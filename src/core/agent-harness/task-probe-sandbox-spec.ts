import { existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { WorkspaceWriteProtection } from "./task-probe-hard-links.js";

const MAX_PROBE_PROCESSES = 256;
const MAX_PROBE_FILE_DESCRIPTORS = 1_024;
const MAX_PROBE_ADDRESS_SPACE_BYTES = 8 * 1024 * 1024 * 1024;

export type AvailableTaskProbeSandbox = {
  status: "available";
  kind: "linux-bubblewrap";
  processBoundary: "pid-namespace";
  command: string;
  prefixArgs: readonly string[];
  probeExecutable: string;
  evidence: string;
};

export type TaskProbeSandbox =
  | AvailableTaskProbeSandbox
  | {
      status: "unavailable";
      reason: string;
    };

export type ContainedWorkspaceSandbox = TaskProbeSandbox;
export type AvailableContainedWorkspaceSandbox = AvailableTaskProbeSandbox;

export type TaskProbeToolchain = {
  nodeExecutable: string;
  pnpmExecutable: string;
  pnpmRuntimePath: string;
};

export type LinuxCoreDumpBoundary =
  | {
      status: "available";
      evidence: string;
    }
  | {
      status: "unavailable";
      reason: string;
    };

function pathIsInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`);
}

export function cpuLimitSeconds(timeoutMs: number): number {
  return Math.max(1, Math.ceil(timeoutMs / 1_000));
}

export function assessLinuxCoreDumpBoundary(
  rawCorePattern: string,
): LinuxCoreDumpBoundary {
  const corePattern = rawCorePattern.trim();
  if (corePattern.length === 0) {
    return {
      status: "unavailable",
      reason:
        "Runtime Probe execution requires a readable, non-empty Linux core_pattern.",
    };
  }
  if (corePattern.startsWith("|")) {
    return {
      status: "unavailable",
      reason:
        "Runtime Probe execution refused because Linux core_pattern invokes a host pipe handler; RLIMIT_CORE=0 does not suppress piped handlers, and sandbox namespaces cannot contain a handler launched in the host's initial namespaces.",
    };
  }
  return {
    status: "available",
    evidence:
      "host core_pattern verified non-piped before launch and RLIMIT_CORE locked at zero",
  };
}

function parentDirectoryArgs(paths: readonly string[]): string[] {
  const directories = new Set<string>();
  for (const path of paths) {
    let current = dirname(path);
    while (current !== dirname(current)) {
      directories.add(current);
      current = dirname(current);
    }
  }

  const args: string[] = [];
  for (const directory of [...directories].sort(
    (left, right) => left.length - right.length,
  )) {
    args.push("--dir", directory);
  }
  return args;
}

const LINUX_SYSTEM_RUNTIME_PATHS = [
  "/usr",
  "/bin",
  "/sbin",
  "/lib",
  "/lib64",
] as const;

function pathIsCoveredBy(
  path: string,
  mountedRoots: readonly string[],
): boolean {
  return mountedRoots.some(
    (root) => root === path || pathIsInside(root, path),
  );
}

export function buildLinuxTaskProbeSandbox(
  workspaceDir: string,
  timeoutMs: number,
  bubblewrapPath: string,
  prlimitPath: string,
  toolchain: TaskProbeToolchain,
  coreDumpBoundary: Extract<LinuxCoreDumpBoundary, { status: "available" }>,
  workspaceWriteProtections: readonly WorkspaceWriteProtection[] = [],
  readProtectedPaths: readonly string[] = [],
): AvailableTaskProbeSandbox {
  const systemRuntimePaths = LINUX_SYSTEM_RUNTIME_PATHS.filter((path) =>
    existsSync(path),
  );
  const explicitRuntimePaths = [
    toolchain.nodeExecutable,
    toolchain.pnpmRuntimePath,
  ].filter((path) => !pathIsCoveredBy(path, systemRuntimePaths));
  const sandboxPathDirectories = parentDirectoryArgs([
    workspaceDir,
    ...explicitRuntimePaths,
  ]);
  const safePath = [
    dirname(toolchain.pnpmExecutable),
    dirname(toolchain.nodeExecutable),
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ]
    .filter((path, index, paths) => paths.indexOf(path) === index)
    .join(":");
  const bubblewrapArgs = [
    "--unshare-all",
    "--disable-userns",
    "--die-with-parent",
    "--new-session",
    ...systemRuntimePaths.flatMap((path) => ["--ro-bind", path, path]),
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
    ...sandboxPathDirectories,
    ...explicitRuntimePaths.flatMap((path) => ["--ro-bind", path, path]),
    "--overlay-src",
    workspaceDir,
    "--tmp-overlay",
    workspaceDir,
    ...workspaceWriteProtections.flatMap(({ path }) => [
      "--ro-bind",
      path,
      path,
    ]),
    ...readProtectedPaths.flatMap((path) => [
      "--ro-bind",
      "/dev/null",
      path,
    ]),
    ...(existsSync(join(workspaceDir, ".git"))
      ? [
          "--ro-bind",
          join(workspaceDir, ".git"),
          join(workspaceDir, ".git"),
        ]
      : []),
    "--setenv",
    "PATH",
    safePath,
    "--chdir",
    workspaceDir,
    "--",
  ];
  return {
    status: "available",
    kind: "linux-bubblewrap",
    processBoundary: "pid-namespace",
    command: prlimitPath,
    prefixArgs: [
      `--cpu=${cpuLimitSeconds(timeoutMs)}:${cpuLimitSeconds(timeoutMs)}`,
      `--nproc=${MAX_PROBE_PROCESSES}:${MAX_PROBE_PROCESSES}`,
      `--nofile=${MAX_PROBE_FILE_DESCRIPTORS}:${MAX_PROBE_FILE_DESCRIPTORS}`,
      `--as=${MAX_PROBE_ADDRESS_SPACE_BYTES}:${MAX_PROBE_ADDRESS_SPACE_BYTES}`,
      "--core=0:0",
      "--",
      bubblewrapPath,
      ...bubblewrapArgs,
    ],
    probeExecutable: toolchain.pnpmExecutable,
    evidence:
      "Linux Bubblewrap empty-root namespace with read-only runtime code, a disposable project tmpfs overlay that prevents workspace writes and new pathname IPC from reaching the host, external-regular-hard-link-bearing entries frozen by nested read-only mounts, isolated device/temp/network/IPC state, a PID namespace whose init exit terminates detached descendants, " +
      `protected project credentials masked, ${coreDumpBoundary.evidence}, plus CPU, memory, process, and descriptor limits`,
  };
}
