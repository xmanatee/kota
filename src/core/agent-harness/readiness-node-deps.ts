import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type {
  AgentHarnessRuntimeProbeDeps,
  BinaryResolution,
  CommandOutputResolution,
  CommandVersionResolution,
  PackageVersionResolution,
} from "./readiness-types.js";

const require = createRequire(import.meta.url);

function trimOutput(stdout: string, stderr: string): string {
  return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").trim();
}

function readPackageJsonVersion(packageJsonPath: string): PackageVersionResolution {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      version?: string;
    };
    if (typeof parsed.version === "string" && parsed.version.trim()) {
      return { status: "ready", version: parsed.version.trim() };
    }
    return {
      status: "error",
      detail: `package.json at ${packageJsonPath} does not declare a version`,
    };
  } catch (err) {
    return {
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function resolvePackageJsonPath(packageName: string): string | null {
  try {
    return require.resolve(`${packageName}/package.json`);
  } catch {
    // Some packages hide package.json behind exports. Fall through and walk up
    // from the resolved entry point.
  }

  try {
    let current = dirname(require.resolve(packageName));
    while (current !== dirname(current)) {
      const candidate = join(current, "package.json");
      if (existsSync(candidate)) return candidate;
      current = dirname(current);
    }
  } catch {
    return null;
  }
  return null;
}

export const NODE_RUNTIME_PROBE_DEPS: AgentHarnessRuntimeProbeDeps = {
  resolveBinary(binaryName: string): BinaryResolution {
    const lookup = process.platform === "win32" ? "where" : "which";
    const result = spawnSync(lookup, [binaryName], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) {
      return { status: "error", detail: result.error.message };
    }
    const output = trimOutput(result.stdout ?? "", result.stderr ?? "");
    if (result.status !== 0) {
      return {
        status: "missing",
        detail: output || `${binaryName} was not found on PATH`,
      };
    }
    const executablePath = output.split(/\r?\n/)[0]?.trim();
    if (!executablePath) {
      return {
        status: "error",
        detail: `${lookup} ${binaryName} succeeded without an executable path`,
      };
    }
    return { status: "ready", executablePath };
  },

  readCommandVersion(
    command: string,
    args: readonly string[],
  ): CommandVersionResolution {
    const result = spawnSync(command, [...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) {
      return { status: "error", detail: result.error.message };
    }
    const output = trimOutput(result.stdout ?? "", result.stderr ?? "");
    if (result.status !== 0) {
      return {
        status: "error",
        detail:
          output ||
          `${command} ${args.join(" ")} exited with status ${result.status}`,
      };
    }
    const version = output.split(/\r?\n/)[0]?.trim() ?? "";
    if (!version) {
      return {
        status: "error",
        detail: `${command} ${args.join(" ")} did not print a version`,
      };
    }
    return { status: "ready", version };
  },

  readCommandOutput(
    command: string,
    args: readonly string[],
  ): CommandOutputResolution {
    const result = spawnSync(command, [...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) {
      return { status: "error", detail: result.error.message };
    }
    const output = trimOutput(result.stdout ?? "", result.stderr ?? "");
    if (result.status !== 0) {
      return {
        status: "error",
        detail:
          output ||
          `${command} ${args.join(" ")} exited with status ${result.status}`,
      };
    }
    return { status: "ready", output };
  },

  readPackageVersion(packageName: string): PackageVersionResolution {
    const packageJsonPath = resolvePackageJsonPath(packageName);
    if (!packageJsonPath) {
      return {
        status: "missing",
        detail: `${packageName} package.json could not be resolved`,
      };
    }
    return readPackageJsonVersion(packageJsonPath);
  },
};
