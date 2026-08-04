import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

const MACOS_NATIVE_RUNTIME_ROOTS = [
  "/System",
  "/usr",
  "/bin",
  "/sbin",
  "/Library/Apple",
  "/private/etc",
  "/dev",
] as const;

const LINUX_NATIVE_RUNTIME_ROOTS = [
  "/usr",
  "/bin",
  "/sbin",
  "/lib",
  "/lib64",
  "/etc",
] as const;

function pathIsWithinRoot(path: string, root: string): boolean {
  const candidate = relative(root, path);
  return candidate === "" || (
    candidate !== ".." &&
    !candidate.startsWith(`..${sep}`) &&
    !isAbsolute(candidate)
  );
}

export function resolveNativeCliExecutable(
  executable: string,
  env: NodeJS.ProcessEnv,
): string {
  const candidates = isAbsolute(executable)
    ? [executable]
    : (env.PATH ?? env.Path ?? "")
        .split(delimiter)
        .filter(Boolean)
        .map((directory) => join(directory, executable));
  const found = candidates.find(existsSync);
  if (found === undefined) return executable;
  return realpathSync.native(found);
}

function nodePackageRoot(path: string): string | undefined {
  const marker = `${sep}node_modules${sep}`;
  const markerIndex = path.lastIndexOf(marker);
  if (markerIndex < 0) return undefined;
  const packageStart = markerIndex + marker.length;
  const segments = path.slice(packageStart).split(sep);
  const packageSegments = segments[0]?.startsWith("@") ? 2 : 1;
  if (segments.length < packageSegments) return undefined;
  return join(path.slice(0, packageStart), ...segments.slice(0, packageSegments));
}

function trustedPathInstallationRoot(path: string): string | undefined {
  const normalized = resolve(path);
  for (const prefix of [
    "/opt/homebrew",
    "/usr/local",
    "/home/linuxbrew/.linuxbrew",
    "/System/Cryptexes/App/usr",
    "/Library/Apple/usr",
  ]) {
    if (pathIsWithinRoot(normalized, prefix)) return prefix;
  }
  const nvmMatch = normalized.match(
    /^(.*\/\.nvm\/versions\/node\/[^/]+)\/bin(?:\/|$)/,
  );
  return nvmMatch?.[1];
}

function safeExecutableDirectory(path: string, cwd: string): boolean {
  const normalized = resolve(path);
  if (pathIsWithinRoot(normalized, resolve(cwd))) return true;
  if (trustedPathInstallationRoot(normalized) !== undefined) return true;
  if (["bin", "sbin"].includes(basename(normalized))) return true;
  return normalized === join(homedir(), "Library", "pnpm");
}

export function nativeCliReadableRoots(
  executablePath: string,
  cwd: string,
  invocationRoot: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const platformRoots = platform === "darwin"
    ? MACOS_NATIVE_RUNTIME_ROOTS
    : LINUX_NATIVE_RUNTIME_ROOTS;
  const pathDirectories = (env.PATH ?? env.Path ?? "")
    .split(delimiter)
    .filter(Boolean)
    .filter((path) => safeExecutableDirectory(path, cwd));
  const dependencyRoot = join(cwd, "node_modules");
  const executablePackageRoot = nodePackageRoot(executablePath);
  const executableInstallationRoot = trustedPathInstallationRoot(executablePath);
  return [...new Set([
    ...platformRoots.filter(existsSync),
    cwd,
    invocationRoot,
    ...(existsSync(dependencyRoot) ? [dependencyRoot] : []),
    ...pathDirectories.filter(existsSync),
    ...pathDirectories.flatMap((path) => {
      const root = trustedPathInstallationRoot(path);
      return root === undefined || !existsSync(root) ? [] : [root];
    }),
    dirname(executablePath),
    ...(executablePackageRoot === undefined ? [] : [executablePackageRoot]),
    ...(executableInstallationRoot === undefined
      ? []
      : [executableInstallationRoot]),
  ])];
}
