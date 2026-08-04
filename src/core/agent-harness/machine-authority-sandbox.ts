import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { getGlobalConfigPath } from "#core/config/config.js";
import { scopeAuthorityOperatorTokenPaths } from "#core/daemon/scope-authority-operator-token.js";
import { resolvePathIdentities } from "#core/util/real-path.js";

export type MachineAuthoritySandboxLaunch =
  | { ok: true; command: string; args: string[] }
  | { ok: false; error: string };

export type MachineAuthoritySandboxOptions = {
  cwd: string;
  authorityConfigPath?: string;
  writableRoots?: readonly string[];
  writeProtectedPaths?: readonly string[];
  platform?: NodeJS.Platform;
  pathExists?: (path: string) => boolean;
};

export type NativeCliSandboxMode = "read-only" | "workspace-write";

export type NativeCliSandboxProcess = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
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
  writableRoots: readonly string[] | undefined,
  writeProtectedPaths: readonly string[],
): string {
  const protectedDirectories = sandboxPathSelectors([
    ...configDirectories,
    ...writeProtectedPaths,
  ]);
  const protectedTokens = tokenPaths.map((path) => `(literal ${JSON.stringify(path)})`);
  return [
    "(version 1)",
    "(allow default)",
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
    `(deny file-write* ${[...protectedDirectories, ...protectedTokens].join(" ")})`,
    `(deny file-read* ${protectedTokens.join(" ")})`,
  ].join("\n");
}

export function buildMachineAuthoritySandboxLaunch(
  executable: string,
  args: readonly string[],
  options: MachineAuthoritySandboxOptions,
): MachineAuthoritySandboxLaunch {
  const platform = options.platform ?? process.platform;
  const pathExists = options.pathExists ?? existsSync;
  const { configDirectories, tokenPaths } = authorityPaths(options.authorityConfigPath);
  const writableRoots = options.writableRoots === undefined
    ? undefined
    : resolveUniquePathIdentities(options.writableRoots, options.cwd);
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
          writableRoots,
          writeProtectedPaths,
        ),
        executable,
        ...args,
      ],
    };
  }

  if (platform === "linux") {
    const bubblewrap = LINUX_BUBBLEWRAP_PATHS.find(pathExists);
    const existingConfigDirectories = configDirectories.filter(pathExists);
    if (bubblewrap === undefined || existingConfigDirectories.length === 0) {
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
    const writableMounts = writableRoots?.flatMap((path) => ["--bind", path, path]) ?? [];
    const protectedMounts = [
      ...writeProtectedPaths,
      ...existingConfigDirectories,
    ].filter(pathExists).flatMap((path) => ["--ro-bind", path, path]);
    const hiddenTokenMounts = tokenPaths.flatMap((tokenPath) =>
      pathExists(tokenPath) ? ["--ro-bind", "/dev/null", tokenPath] : []
    );
    return {
      ok: true,
      command: bubblewrap,
      args: [
        "--die-with-parent",
        "--new-session",
        writableRoots === undefined ? "--bind" : "--ro-bind",
        "/",
        "/",
        ...writableMounts,
        ...protectedMounts,
        ...hiddenTokenMounts,
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

export async function withNativeCliSandbox<T>(
  executable: string,
  args: readonly string[],
  options: {
    cwd: string;
    authorityConfigPath?: string;
    mode: NativeCliSandboxMode;
    env: NodeJS.ProcessEnv;
    prepareEnvironment?: (
      temporaryDirectory: string,
      env: NodeJS.ProcessEnv,
    ) => NodeJS.ProcessEnv;
  },
  run: (process: NativeCliSandboxProcess) => Promise<T>,
): Promise<T> {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "kota-native-cli-"));
  try {
    const launch = buildMachineAuthoritySandboxLaunch(executable, args, {
      cwd: options.cwd,
      authorityConfigPath: options.authorityConfigPath,
      writableRoots: options.mode === "workspace-write"
        ? [options.cwd, temporaryDirectory]
        : [temporaryDirectory],
      writeProtectedPaths: [join(options.cwd, ".git")],
    });
    if (!launch.ok) throw new Error(launch.error);
    const baseEnvironment = {
      ...options.env,
      TMPDIR: temporaryDirectory,
      TMP: temporaryDirectory,
      TEMP: temporaryDirectory,
    };
    return await run({
      command: launch.command,
      args: launch.args,
      env: options.prepareEnvironment?.(
        temporaryDirectory,
        baseEnvironment,
      ) ?? baseEnvironment,
    });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

const SANDBOX_BOOTSTRAP_ERROR = "sandbox-exec: sandbox_apply: Operation not permitted";

export function isNativeCliSandboxBootstrapError(text: string): boolean {
  return text.includes(SANDBOX_BOOTSTRAP_ERROR);
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
