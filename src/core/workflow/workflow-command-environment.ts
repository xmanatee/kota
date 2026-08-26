import { existsSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { withAutomationProcessEnv } from "#core/util/automation-process-env.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";

const SYSTEM_COMMAND_PATH_ENTRIES = [
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  "/usr/local/sbin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
] as const;

function splitPath(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(delimiter).filter((entry) => entry.length > 0);
}

function uniquePath(entries: readonly string[]): string {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const entry of entries) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    unique.push(entry);
  }
  return unique.join(delimiter);
}

function collectNodeModulesBinDirs(cwd: string): string[] {
  const dirs: string[] = [];
  let current = resolve(cwd);
  while (true) {
    const candidate = join(current, "node_modules", ".bin");
    if (existsSync(candidate)) dirs.push(candidate);
    const parent = dirname(current);
    if (parent === current) return dirs;
    current = parent;
  }
}

export function buildWorkflowCommandEnv(
  cwd: string,
  baseEnv: Readonly<NodeJS.ProcessEnv> | undefined,
  commandEnv: Readonly<NodeJS.ProcessEnv> | undefined,
  inheritProcessEnv = true,
): NodeJS.ProcessEnv {
  const env = withAutomationProcessEnv(
    withProtectedGitBareRepositoryEnv({
      ...(inheritProcessEnv ? process.env : {}),
      ...baseEnv,
      ...commandEnv,
    }),
  );
  const pathValue = uniquePath([
    ...collectNodeModulesBinDirs(cwd),
    dirname(process.execPath),
    ...splitPath(env.PATH),
    ...splitPath(env.Path),
    ...SYSTEM_COMMAND_PATH_ENTRIES,
  ]);
  env.PATH = pathValue;
  if (env.Path !== undefined) env.Path = pathValue;
  return env;
}
