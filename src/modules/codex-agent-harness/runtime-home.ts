import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function resolveCodexHome(env: NodeJS.ProcessEnv): string {
  const explicitCodexHome = env.CODEX_HOME?.trim();
  if (explicitCodexHome) return explicitCodexHome;
  const home = env.HOME?.trim();
  return join(home || homedir(), ".codex");
}

export function prepareCodexRuntimeEnvironment(
  temporaryDirectory: string,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const sourceAuthPath = join(resolveCodexHome(env), "auth.json");
  const runtimeHome = join(temporaryDirectory, "codex-home");
  mkdirSync(runtimeHome, { mode: 0o700 });
  if (existsSync(sourceAuthPath)) {
    copyFileSync(sourceAuthPath, join(runtimeHome, "auth.json"));
  }
  return { ...env, CODEX_HOME: runtimeHome };
}
