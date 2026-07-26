import {
  closeSync,
  lstatSync,
  openSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

const ANALYZER_MEMORY_LIMIT_MB = 256;
const ANALYZER_CPU_LIMIT = "0.5";
const ANALYZER_CPU_TIME_LIMIT_SECONDS = 10;
const ANALYZER_PID_LIMIT = 32;
const ANALYZER_FILE_DESCRIPTOR_LIMIT = 64;
const ANALYZER_TMPFS_LIMIT_MB = 16;
const CONTAINER_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type AvailableScientificClaimAnalyzerSandbox = {
  kind: "oci-container";
  command: string;
  image: string;
  evidence: string;
};

export type ScientificClaimAnalyzerInvocation = {
  nodeOptions: readonly string[];
  scriptPath: string;
  scriptArgs: readonly string[];
};

export type PreparedAnalyzerFilesystem = {
  workingDir: string;
  writablePaths: string[];
};

function pathIsInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return (
    rel !== "" &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel)
  );
}

function prepareSelectedPath(
  workingDir: string,
  path: string,
  mode: "read" | "write",
): string {
  if (!isAbsolute(path)) {
    throw new Error(`analyzer ${mode} path must be absolute: ${path}`);
  }
  if (mode === "write" && lstatSync(path, { throwIfNoEntry: false }) === undefined) {
    closeSync(openSync(path, "wx", 0o600));
  }
  const resolved = realpathSync(path);
  if (!pathIsInside(workingDir, resolved) || !statSync(resolved).isFile()) {
    throw new Error(
      `analyzer ${mode} path must be a regular file below ${workingDir}: ${path}`,
    );
  }
  return resolved;
}

function assertClosedWorkingTree(
  workingDir: string,
  selectedPaths: ReadonlySet<string>,
  directory = workingDir,
): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      assertClosedWorkingTree(workingDir, selectedPaths, path);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        `analyzer working directory contains a non-regular entry: ${path}`,
      );
    }
    const resolved = realpathSync(path);
    if (!selectedPaths.has(resolved)) {
      throw new Error(`analyzer working directory contains an undeclared file: ${path}`);
    }
  }
}

export function prepareAnalyzerFilesystem(params: {
  cwd: string;
  readOnlyPaths: readonly string[];
  writablePaths: readonly string[];
}): PreparedAnalyzerFilesystem {
  const workingDir = realpathSync(params.cwd);
  const readOnlyPaths = params.readOnlyPaths.map((path) =>
    prepareSelectedPath(workingDir, path, "read"),
  );
  const writablePaths = params.writablePaths.map((path) =>
    prepareSelectedPath(workingDir, path, "write"),
  );
  const selectedPaths = new Set([...readOnlyPaths, ...writablePaths]);
  if (selectedPaths.size !== readOnlyPaths.length + writablePaths.length) {
    throw new Error("analyzer read and write paths must be distinct");
  }
  assertClosedWorkingTree(workingDir, selectedPaths);
  return { workingDir, writablePaths };
}

function bindMount(source: string, readonly: boolean): string {
  if (source.includes(",")) {
    throw new Error(`analyzer container paths cannot contain commas: ${source}`);
  }
  return `type=bind,source=${source},target=${source}${readonly ? ",readonly" : ""}`;
}

function containerEnvironmentArgs(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(env)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([key, value]) => {
      if (!CONTAINER_ENV_KEY_PATTERN.test(key)) {
        throw new Error(`invalid analyzer container environment key: ${key}`);
      }
      if (value.includes("\n") || value.includes("\r")) {
        throw new Error(`analyzer container environment ${key} contains a line break`);
      }
      return ["--env", `${key}=${value}`];
    });
}

export function scientificClaimAnalyzerContainerArgs(params: {
  isolation: AvailableScientificClaimAnalyzerSandbox;
  invocation: ScientificClaimAnalyzerInvocation;
  filesystem: PreparedAnalyzerFilesystem;
  env: NodeJS.ProcessEnv;
  cidFile: string;
}): string[] {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  const gid = typeof process.getgid === "function" ? process.getgid() : null;
  if (uid === null || gid === null) {
    throw new Error("analyzer containers require a POSIX uid and gid");
  }
  const memoryLimit = `${ANALYZER_MEMORY_LIMIT_MB}m`;
  return [
    "run",
    "--rm",
    "--init",
    "--cidfile",
    params.cidFile,
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--user",
    `${uid}:${gid}`,
    "--cpus",
    ANALYZER_CPU_LIMIT,
    "--memory",
    memoryLimit,
    "--memory-swap",
    memoryLimit,
    "--pids-limit",
    String(ANALYZER_PID_LIMIT),
    "--ulimit",
    `cpu=${ANALYZER_CPU_TIME_LIMIT_SECONDS}:${ANALYZER_CPU_TIME_LIMIT_SECONDS}`,
    "--ulimit",
    `nofile=${ANALYZER_FILE_DESCRIPTOR_LIMIT}:${ANALYZER_FILE_DESCRIPTOR_LIMIT}`,
    "--tmpfs",
    `/tmp:rw,noexec,nosuid,nodev,size=${ANALYZER_TMPFS_LIMIT_MB}m`,
    "--mount",
    bindMount(params.filesystem.workingDir, true),
    ...params.filesystem.writablePaths.flatMap((path) => [
      "--mount",
      bindMount(path, false),
    ]),
    "--workdir",
    params.filesystem.workingDir,
    ...containerEnvironmentArgs(params.env),
    "--entrypoint",
    "node",
    params.isolation.image,
    ...params.invocation.nodeOptions,
    params.invocation.scriptPath,
    ...params.invocation.scriptArgs,
  ];
}
