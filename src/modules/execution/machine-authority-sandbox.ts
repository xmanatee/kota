import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getGlobalConfigPath } from "#core/config/config.js";
import { scopeAuthorityOperatorTokenPath } from "#core/daemon/scope-authority-operator-token.js";

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
  configDirectory: string;
  tokenPaths: string[];
} {
  const configPath = resolve(authorityConfigPath ?? getGlobalConfigPath());
  return {
    configDirectory: dirname(configPath),
    tokenPaths: [...new Set([
      scopeAuthorityOperatorTokenPath(configPath),
      scopeAuthorityOperatorTokenPath(),
    ])],
  };
}

function macosProfile(configDirectory: string, tokenPaths: readonly string[]): string {
  const protectedDirectory = JSON.stringify(configDirectory);
  const protectedTokens = tokenPaths.map((path) => `(literal ${JSON.stringify(path)})`);
  return [
    "(version 1)",
    "(allow default)",
    `(deny file-write* (literal ${protectedDirectory}) (subpath ${protectedDirectory}) ${protectedTokens.join(" ")})`,
    `(deny file-read* ${protectedTokens.join(" ")})`,
  ].join("\n");
}

/**
 * Wrap arbitrary agent-authored execution in an OS-enforced boundary. The
 * sandbox is deliberately fail-closed: text inspection cannot prove that an
 * opaque shell, Node, or Python program will not rewrite machine authority.
 */
export function buildMachineAuthoritySandboxLaunch(
  executable: string,
  args: readonly string[],
  options: MachineAuthoritySandboxOptions,
): MachineAuthoritySandboxLaunch {
  const platform = options.platform ?? process.platform;
  const pathExists = options.pathExists ?? existsSync;
  const { configDirectory, tokenPaths } = authorityPaths(options.authorityConfigPath);

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
      args: ["-p", macosProfile(configDirectory, tokenPaths), executable, ...args],
    };
  }

  if (platform === "linux") {
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
