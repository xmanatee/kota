import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getGlobalConfigPath } from "#core/config/config.js";
import { scopeAuthorityOperatorTokenPaths } from "#core/daemon/scope-authority-operator-token.js";
import { resolvePathIdentities } from "#core/util/real-path.js";
import {
  type MachineAuthorityNetworkAccess,
  type MachineAuthorityWriteBoundary,
  macosMachineAuthorityProfile,
  pathIsWithinRoots,
  resolveUniquePathIdentities,
  resolveWriteBoundaries,
} from "./machine-authority-sandbox-paths.js";

export type { MachineAuthorityWriteBoundary } from "./machine-authority-sandbox-paths.js";

export type MachineAuthoritySandboxLaunch =
  | { ok: true; command: string; args: string[] }
  | { ok: false; error: string };

export type MachineAuthoritySandboxOptions = {
  cwd: string;
  authorityConfigPath?: string;
  readableRoots?: readonly string[];
  writableRoots?: readonly string[];
  readProtectedPaths?: readonly string[];
  readProtectedRoots?: readonly string[];
  readProtectedRootMask?: string;
  writeProtectedPaths?: readonly string[];
  writeBoundaries?: readonly MachineAuthorityWriteBoundary[];
  networkAccess?: MachineAuthorityNetworkAccess;
  platform?: NodeJS.Platform;
  pathExists?: (path: string) => boolean;
};

const LINUX_BUBBLEWRAP_PATHS = ["/usr/bin/bwrap", "/bin/bwrap"] as const;
const MACOS_SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";

function authorityPaths(authorityConfigPath?: string): {
  configDirectories: string[];
  tokenPaths: string[];
} {
  const configPath = resolve(authorityConfigPath ?? getGlobalConfigPath());
  return {
    configDirectories: resolvePathIdentities(dirname(configPath), process.cwd()),
    tokenPaths: scopeAuthorityOperatorTokenPaths(configPath),
  };
}

export function buildMachineAuthoritySandboxLaunch(
  executable: string,
  args: readonly string[],
  options: MachineAuthoritySandboxOptions,
): MachineAuthoritySandboxLaunch {
  const platform = options.platform ?? process.platform;
  const pathExists = options.pathExists ?? existsSync;
  const { configDirectories, tokenPaths } = authorityPaths(options.authorityConfigPath);
  const readableRoots = options.readableRoots === undefined
    ? undefined
    : resolveUniquePathIdentities(options.readableRoots, options.cwd);
  const writableRoots = options.writableRoots === undefined
    ? undefined
    : resolveUniquePathIdentities(options.writableRoots, options.cwd);
  const readProtectedPaths = resolveUniquePathIdentities(
    options.readProtectedPaths ?? [],
    options.cwd,
  );
  const readProtectedRoots = resolveUniquePathIdentities(
    options.readProtectedRoots ?? [],
    options.cwd,
  );
  const writeProtectedPaths = resolveUniquePathIdentities(
    options.writeProtectedPaths ?? [],
    options.cwd,
  );
  let writeBoundaries: MachineAuthorityWriteBoundary[];
  try {
    writeBoundaries = resolveWriteBoundaries(options.writeBoundaries ?? [], options.cwd);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (platform === "darwin") {
    if (!pathExists(MACOS_SANDBOX_EXEC_PATH)) {
      return {
        ok: false,
        error: "machine authority sandbox unavailable: sandbox-exec was not found",
      };
    }
    return {
      ok: true,
      command: MACOS_SANDBOX_EXEC_PATH,
      args: [
        "-p",
        macosMachineAuthorityProfile({
          configDirectories,
          tokenPaths,
          readableRoots,
          writableRoots,
          readProtectedPaths,
          readProtectedRoots,
          writeProtectedPaths,
          writeBoundaries,
          networkAccess: options.networkAccess,
        }),
        executable,
        ...args,
      ],
    };
  }

  if (platform === "linux") {
    const bubblewrap = LINUX_BUBBLEWRAP_PATHS.find(pathExists);
    const existingConfigDirectories = configDirectories.filter(pathExists);
    if (
      bubblewrap === undefined ||
      (readableRoots === undefined && existingConfigDirectories.length === 0)
    ) {
      return {
        ok: false,
        error:
          "machine authority sandbox unavailable: bubblewrap and the authority directory are required",
      };
    }
    const missingWritableRoot = writableRoots?.find((path) => !pathExists(path));
    if (missingWritableRoot !== undefined) {
      return {
        ok: false,
        error: `machine authority sandbox writable root does not exist: ${missingWritableRoot}`,
      };
    }
    const missingReadableRoot = readableRoots?.find((path) => !pathExists(path));
    if (missingReadableRoot !== undefined) {
      return {
        ok: false,
        error: `machine authority sandbox readable root does not exist: ${missingReadableRoot}`,
      };
    }
    const missingBoundaryPath = writeBoundaries
      .flatMap((boundary) => [boundary.root, ...boundary.writableDescendants])
      .find((path) => !pathExists(path));
    if (missingBoundaryPath !== undefined) {
      return {
        ok: false,
        error: `machine authority sandbox write boundary path does not exist: ${missingBoundaryPath}`,
      };
    }
    const readableMounts = readableRoots?.flatMap((path) => [
      "--ro-bind",
      path,
      path,
    ]) ?? [];
    const writableMounts = writableRoots?.flatMap((path) => ["--bind", path, path]) ?? [];
    const visibleRoots = readableRoots ?? ["/"];
    const protectedMounts = [
      ...writeProtectedPaths,
      ...existingConfigDirectories,
    ].filter(
      (path) => pathExists(path) && pathIsWithinRoots(path, visibleRoots),
    ).flatMap((path) => ["--ro-bind", path, path]);
    const boundaryMounts = writeBoundaries.flatMap((boundary) => [
      "--ro-bind",
      boundary.root,
      boundary.root,
      ...boundary.writableDescendants.flatMap((path) => ["--bind", path, path]),
    ]);
    const hiddenReadMounts = [...readProtectedPaths, ...tokenPaths].flatMap((path) =>
      pathExists(path) && pathIsWithinRoots(path, visibleRoots)
        ? ["--ro-bind", "/dev/null", path]
        : []
    );
    const existingProtectedRoots = readProtectedRoots.filter(
      (path) => pathExists(path) && pathIsWithinRoots(path, visibleRoots),
    );
    const readProtectedRootMask = options.readProtectedRootMask === undefined
      ? undefined
      : resolve(options.readProtectedRootMask);
    if (
      existingProtectedRoots.length > 0 &&
      (
        readProtectedRootMask === undefined ||
        !pathExists(readProtectedRootMask)
      )
    ) {
      return {
        ok: false,
        error:
          "machine authority sandbox protected read roots require an existing empty-directory mask",
      };
    }
    const hiddenReadRootMounts = existingProtectedRoots.flatMap((path) => [
      "--ro-bind",
      readProtectedRootMask!,
      path,
    ]);
    return {
      ok: true,
      command: bubblewrap,
      args: [
        "--die-with-parent",
        "--new-session",
        ...(readableRoots === undefined
          ? [writableRoots === undefined ? "--bind" : "--ro-bind", "/", "/"]
          : [
              "--unshare-pid",
              "--unshare-ipc",
              "--unshare-uts",
              ...(options.networkAccess === undefined ? [] : ["--unshare-net"]),
              "--proc",
              "/proc",
              "--dev",
              "/dev",
              ...readableMounts,
            ]),
        ...writableMounts,
        ...protectedMounts,
        ...boundaryMounts,
        ...hiddenReadMounts,
        ...hiddenReadRootMounts,
        "--chdir",
        resolve(options.cwd),
        "--",
        executable,
        ...args,
      ],
    };
  }

  return {
    ok: false,
    error: `machine authority sandbox unavailable on ${platform}`,
  };
}

export function buildShellMachineAuthoritySandboxLaunch(
  command: string,
  cwd: string,
  authorityConfigPath: string | undefined,
): MachineAuthoritySandboxLaunch {
  if (authorityConfigPath === undefined) {
    return { ok: true, command: "sh", args: ["-c", command] };
  }
  return buildMachineAuthoritySandboxLaunch("sh", ["-c", command], {
    cwd,
    authorityConfigPath,
  });
}
