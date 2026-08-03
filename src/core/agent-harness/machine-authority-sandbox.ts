import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getGlobalConfigPath } from "#core/config/config.js";
import { scopeAuthorityOperatorTokenPaths } from "#core/daemon/scope-authority-operator-token.js";
import { resolvePathIdentities } from "#core/util/real-path.js";

export type MachineAuthoritySandboxLaunch =
  | { ok: true; command: string; args: string[] }
  | { ok: false; error: string };

export type MachineAuthoritySandboxOptions = {
  cwd: string;
  authorityConfigPath?: string;
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

function macosProfile(
  configDirectories: readonly string[],
  tokenPaths: readonly string[],
): string {
  const protectedDirectories = configDirectories.flatMap((directory) => [
    `(literal ${JSON.stringify(directory)})`,
    `(subpath ${JSON.stringify(directory)})`,
  ]);
  const protectedTokens = tokenPaths.map((path) => `(literal ${JSON.stringify(path)})`);
  return [
    "(version 1)",
    "(allow default)",
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
      args: ["-p", macosProfile(configDirectories, tokenPaths), executable, ...args],
    };
  }

  if (platform === "linux") {
    const configDirectory = configDirectories.at(-1)!;
    const bubblewrap = LINUX_BUBBLEWRAP_PATHS.find(pathExists);
    if (bubblewrap === undefined || !pathExists(configDirectory)) {
      return {
        ok: false,
        error:
          "machine authority sandbox unavailable: bubblewrap and the authority directory are required",
      };
    }
    const hiddenTokenMounts = tokenPaths.flatMap((tokenPath) =>
      pathExists(tokenPath) ? ["--ro-bind", "/dev/null", tokenPath] : []
    );
    return {
      ok: true,
      command: bubblewrap,
      args: [
        "--die-with-parent",
        "--new-session",
        "--bind",
        "/",
        "/",
        "--ro-bind",
        configDirectory,
        configDirectory,
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
