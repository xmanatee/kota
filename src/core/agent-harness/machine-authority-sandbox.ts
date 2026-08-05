import { existsSync } from "node:fs";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { getGlobalConfigPath } from "#core/config/config.js";
import { scopeAuthorityOperatorTokenPaths } from "#core/daemon/scope-authority-operator-token.js";
import { resolvePathIdentities } from "#core/util/real-path.js";

export type MachineAuthoritySandboxLaunch =
  | { ok: true; command: string; args: string[] }
  | { ok: false; error: string };

export type MachineAuthoritySandboxOptions = {
  cwd: string;
  authorityConfigPath?: string;
  readableRoots?: readonly string[];
  writableRoots?: readonly string[];
  readProtectedPaths?: readonly string[];
  writeProtectedPaths?: readonly string[];
  networkAccess?:
    | { kind: "offline" }
    | { kind: "loopback-proxy"; port: number };
  platform?: NodeJS.Platform;
  pathExists?: (path: string) => boolean;
};

const LINUX_BUBBLEWRAP_PATHS = ["/usr/bin/bwrap", "/bin/bwrap"] as const;
const MACOS_SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";
// Git sanitizes its standard descriptors through this sink before every command.
const MACOS_WRITABLE_DEVICE_PATHS = ["/dev/null"] as const;

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

function resolveUniquePathIdentities(
  paths: readonly string[],
  cwd: string,
): string[] {
  return [...new Set(paths.flatMap((path) => resolvePathIdentities(path, cwd)))];
}

function sandboxPathSelectors(paths: readonly string[]): string[] {
  return paths.flatMap((path) => [
    `(literal ${JSON.stringify(path)})`,
    `(subpath ${JSON.stringify(path)})`,
  ]);
}

function macosProfile(
  configDirectories: readonly string[],
  tokenPaths: readonly string[],
  readableRoots: readonly string[] | undefined,
  writableRoots: readonly string[] | undefined,
  readProtectedPaths: readonly string[],
  writeProtectedPaths: readonly string[],
  networkAccess: MachineAuthoritySandboxOptions["networkAccess"],
): string {
  const protectedDirectories = sandboxPathSelectors([
    ...configDirectories,
    ...writeProtectedPaths,
  ]);
  const protectedReads = [...readProtectedPaths, ...tokenPaths]
    .map((path) => `(literal ${JSON.stringify(path)})`);
  return [
    "(version 1)",
    "(allow default)",
    ...(networkAccess === undefined
      ? []
      : [
          "(deny network*)",
          '(allow network-inbound (local tcp "localhost:*"))',
          ...(networkAccess.kind === "loopback-proxy"
            ? [
                `(allow network-outbound (remote tcp ${JSON.stringify(`localhost:${networkAccess.port}`)}))`,
              ]
            : []),
        ]),
    ...(readableRoots === undefined
      ? []
      : [
          "(deny file-read*)",
          "(allow file-read-metadata)",
          `(allow file-read* (literal "/") ${sandboxPathSelectors(readableRoots).join(" ")})`,
        ]),
    ...(writableRoots === undefined
      ? []
      : [
          "(deny file-write*)",
          `(allow file-write* ${[
            ...MACOS_WRITABLE_DEVICE_PATHS.map(
              (path) => `(literal ${JSON.stringify(path)})`,
            ),
            ...sandboxPathSelectors(writableRoots),
          ].join(" ")})`,
        ]),
    `(deny file-write* ${[...protectedDirectories, ...protectedReads].join(" ")})`,
    `(deny file-read* ${protectedReads.join(" ")})`,
  ].join("\n");
}

function pathIsWithinRoots(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => {
    const candidate = relative(root, path);
    return candidate === "" || (
      candidate !== ".." &&
      !candidate.startsWith(`..${sep}`) &&
      !isAbsolute(candidate)
    );
  });
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
  const writeProtectedPaths = resolveUniquePathIdentities(
    options.writeProtectedPaths ?? [],
    options.cwd,
  );

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
        macosProfile(
          configDirectories,
          tokenPaths,
          readableRoots,
          writableRoots,
          readProtectedPaths,
          writeProtectedPaths,
          options.networkAccess,
        ),
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
    const hiddenReadMounts = [...readProtectedPaths, ...tokenPaths].flatMap((path) =>
      pathExists(path) && pathIsWithinRoots(path, visibleRoots)
        ? ["--ro-bind", "/dev/null", path]
        : []
    );
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
        ...hiddenReadMounts,
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
