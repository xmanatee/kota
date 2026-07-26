import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, sep } from "node:path";
import type { TaskProbeToolchain } from "./task-probe-sandbox-spec.js";

const PNPM_RUNTIME_PACKAGE_NAMES = new Set(["pnpm", "corepack", "@pnpm/exe"]);

export type TaskProbeToolchainResolution =
  | { status: "available"; toolchain: TaskProbeToolchain }
  | { status: "unavailable"; reason: string };

function pathContains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`));
}

function resolvePathExecutable(name: string): string | null {
  for (const pathEntry of (process.env.PATH ?? "").split(delimiter)) {
    if (!pathEntry || !isAbsolute(pathEntry)) continue;
    const candidate = join(pathEntry, name);
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {
      // Continue through the trusted host PATH; relative entries are rejected.
    }
  }
  return null;
}

function packageManagerRuntimePath(executable: string): string {
  let current = dirname(executable);
  for (let depth = 0; depth < 3 && current !== dirname(current); depth += 1) {
    const manifestPath = join(current, "package.json");
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
          name?: string;
        };
        if (
          manifest.name !== undefined &&
          PNPM_RUNTIME_PACKAGE_NAMES.has(manifest.name)
        ) {
          return current;
        }
      } catch {
        // A malformed unrelated ancestor manifest is not the pnpm runtime root.
      }
    }
    current = dirname(current);
  }
  return executable;
}

export function resolveTaskProbeToolchain(
  workspaceDir: string,
): TaskProbeToolchainResolution {
  const nodeExecutable = realpathSync(process.execPath);
  const pnpmExecutable = resolvePathExecutable("pnpm");
  if (pnpmExecutable === null) {
    return {
      status: "unavailable",
      reason:
        "Runtime Probe OS sandbox cannot resolve pnpm from an absolute host PATH entry.",
    };
  }
  const pnpmRuntimePath = packageManagerRuntimePath(pnpmExecutable);
  if (
    pathContains(workspaceDir, nodeExecutable) ||
    pathContains(workspaceDir, pnpmRuntimePath) ||
    pathContains(pnpmRuntimePath, workspaceDir)
  ) {
    return {
      status: "unavailable",
      reason:
        "Runtime Probe OS sandbox requires node and pnpm runtimes outside the mutable project.",
    };
  }
  return {
    status: "available",
    toolchain: { nodeExecutable, pnpmExecutable, pnpmRuntimePath },
  };
}
