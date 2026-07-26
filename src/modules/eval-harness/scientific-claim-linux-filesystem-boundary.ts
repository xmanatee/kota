import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import {
  closeSync,
  lstatSync,
  mkdtempSync,
  openSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

const RUNTIME_FILES_PROBE =
  "process.stdout.write(JSON.stringify(process.report.getReport().sharedObjects))";
const WORKING_DIRECTORY_BOOTSTRAP = `
const { pathToFileURL } = require("node:url");
const [workingDir, scriptPath, ...scriptArgs] = process.argv.slice(1);
process.chdir(workingDir);
process.argv = [process.execPath, scriptPath, ...scriptArgs];
import(pathToFileURL(scriptPath).href).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`;

/**
 * The mount namespace starts with the host tree, so make it private before
 * constructing a new root. Bind only regular files: the Node executable, its
 * startup shared-object closure, the selected analyzer/input files, and the
 * exact output file. Directory binds are forbidden because a read-only bind
 * still exposes every pathname Unix socket below that directory.
 */
export const LINUX_ANALYZER_FILESYSTEM_BOUNDARY = `
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

root=$1
working_dir=$2
node_path=$3
runtime_file_count=$4
read_file_count=$5
write_file_count=$6
shift 6

mount --make-rprivate /
mount -t tmpfs -o mode=0755,nosuid,nodev tmpfs "$root"

mount_file() {
  source_path=$1
  mount_mode=$2
  if [ ! -f "$source_path" ]; then
    echo "analyzer boundary source is not a regular file: $source_path" >&2
    exit 80
  fi
  destination="$root$source_path"
  mkdir -p "$(dirname "$destination")"
  touch "$destination"
  mount --bind "$source_path" "$destination"
  mount -o "remount,bind,$mount_mode,nosuid,nodev" "$destination"
}

runtime_files_remaining=$runtime_file_count
while [ "$runtime_files_remaining" -gt 0 ]; do
  mount_file "$1" ro
  shift
  runtime_files_remaining=$((runtime_files_remaining - 1))
done

read_files_remaining=$read_file_count
while [ "$read_files_remaining" -gt 0 ]; do
  mount_file "$1" ro
  shift
  read_files_remaining=$((read_files_remaining - 1))
done

write_files_remaining=$write_file_count
while [ "$write_files_remaining" -gt 0 ]; do
  mount_file "$1" rw
  shift
  write_files_remaining=$((write_files_remaining - 1))
done

mkdir -p "$root$working_dir" "$root/proc" "$root/tmp"
chmod 1777 "$root/tmp"
mount -t proc -o nosuid,nodev,noexec proc "$root/proc"

chroot_path=$(command -v chroot)
unset PATH
exec "$chroot_path" "$root" "$node_path" "$@"
`;

function assertRegularFile(path: string, label: string): void {
  if (!isAbsolute(path) || !statSync(path).isFile()) {
    throw new Error(`${label} must be an absolute regular file: ${path}`);
  }
}

function assertSelectedPath(workingDir: string, path: string, label: string): void {
  const relativePath = relative(workingDir, path);
  if (
    !isAbsolute(path) ||
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${label} must be a file below ${workingDir}: ${path}`);
  }
}

export function resolveLinuxAnalyzerRuntimeFiles(): string[] {
  const result = spawnSync(
    process.execPath,
    ["-e", RUNTIME_FILES_PROBE],
    {
      encoding: "utf8",
      env: { LANG: "C", LC_ALL: "C", NO_COLOR: "1" },
      killSignal: "SIGKILL",
      maxBuffer: 256 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 2_000,
    },
  );
  if (result.status !== 0 || result.error !== undefined) {
    const diagnostics = [result.stderr, result.error?.message]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(
      `could not resolve the Node runtime file closure${diagnostics.length > 0 ? `: ${diagnostics}` : ""}`,
    );
  }

  let sharedObjects: string[];
  try {
    const parsed: string[] | null = JSON.parse(result.stdout);
    if (
      !Array.isArray(parsed) ||
      !parsed.every((path) => typeof path === "string")
    ) {
      throw new Error("sharedObjects was not a string array");
    }
    sharedObjects = parsed;
  } catch (error) {
    throw new Error(
      `could not parse the Node runtime file closure: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const runtimeFiles = [...new Set([process.execPath, ...sharedObjects])];
  for (const path of runtimeFiles) {
    assertRegularFile(path, "analyzer runtime dependency");
  }
  return runtimeFiles;
}

function prepareSelectedFiles(params: {
  workingDir: string;
  readOnlyPaths: readonly string[];
  writablePaths: readonly string[];
}): { readOnlyPaths: string[]; writablePaths: string[] } {
  const workingDir = realpathSync(params.workingDir);
  const readOnlyPaths = params.readOnlyPaths.map((path) => {
    const resolvedPath = realpathSync(path);
    assertSelectedPath(workingDir, resolvedPath, "analyzer read path");
    assertRegularFile(resolvedPath, "analyzer read path");
    return resolvedPath;
  });
  const writablePaths = params.writablePaths.map((path) => {
    const resolvedParent = realpathSync(dirname(path));
    const resolvedPath = join(resolvedParent, basename(path));
    assertSelectedPath(workingDir, resolvedPath, "analyzer write path");
    if (lstatSync(path, { throwIfNoEntry: false }) === undefined) {
      closeSync(openSync(path, "wx", 0o600));
    }
    if (realpathSync(path) !== resolvedPath) {
      throw new Error(`analyzer write path must not be a symlink: ${path}`);
    }
    assertRegularFile(resolvedPath, "analyzer write path");
    return resolvedPath;
  });
  return { readOnlyPaths, writablePaths };
}

export function linuxAnalyzerBoundaryArgs(params: {
  prefixArgs: readonly string[];
  sandboxRoot: string;
  workingDir: string;
  nodePath: string;
  runtimeFiles: readonly string[];
  readOnlyPaths: readonly string[];
  writablePaths: readonly string[];
  nodeArgs: readonly string[];
}): string[] {
  return [
    ...params.prefixArgs,
    "/bin/sh",
    "-ceu",
    LINUX_ANALYZER_FILESYSTEM_BOUNDARY,
    "kota-analyzer-boundary",
    params.sandboxRoot,
    params.workingDir,
    params.nodePath,
    String(params.runtimeFiles.length),
    String(params.readOnlyPaths.length),
    String(params.writablePaths.length),
    ...params.runtimeFiles,
    ...params.readOnlyPaths,
    ...params.writablePaths,
    ...params.nodeArgs,
  ];
}

export function linuxAnalyzerInvocationArgs(params: {
  workingDir: string;
  nodeOptions: readonly string[];
  scriptPath: string;
  scriptArgs: readonly string[];
}): string[] {
  return [
    ...params.nodeOptions,
    "-e",
    WORKING_DIRECTORY_BOOTSTRAP,
    params.workingDir,
    params.scriptPath,
    ...params.scriptArgs,
  ];
}

export function spawnScientificClaimLinuxAnalyzer(params: {
  command: string;
  prefixArgs: readonly string[];
  runtimeFiles: readonly string[];
  readOnlyPaths: readonly string[];
  writablePaths: readonly string[];
  nodeOptions: readonly string[];
  scriptPath: string;
  scriptArgs: readonly string[];
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    maxBuffer: number;
    timeout: number;
  };
}): SpawnSyncReturns<string> {
  const sandboxRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "kota-analyzer-root-")),
  );
  try {
    const workingDir = realpathSync(params.options.cwd);
    const selectedFiles = prepareSelectedFiles({
      workingDir,
      readOnlyPaths: params.readOnlyPaths,
      writablePaths: params.writablePaths,
    });
    return spawnSync(
      params.command,
      linuxAnalyzerBoundaryArgs({
        prefixArgs: params.prefixArgs,
        sandboxRoot,
        workingDir,
        nodePath: process.execPath,
        runtimeFiles: params.runtimeFiles,
        readOnlyPaths: selectedFiles.readOnlyPaths,
        writablePaths: selectedFiles.writablePaths,
        nodeArgs: linuxAnalyzerInvocationArgs({
          workingDir,
          nodeOptions: params.nodeOptions,
          scriptPath: params.scriptPath,
          scriptArgs: params.scriptArgs,
        }),
      }),
      {
        ...params.options,
        encoding: "utf8",
        killSignal: "SIGKILL",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } finally {
    rmSync(sandboxRoot, { recursive: true, force: true });
  }
}
