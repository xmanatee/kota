import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { NativeCliRuntimeContext } from "#core/agent-harness/native-cli-sandbox.js";
import {
  PROTECTED_PROJECT_ENV_GLOBS,
  PROTECTED_PROJECT_RUNTIME_FILES,
} from "#core/tools/protected-project-paths.js";

const CODEX_PERMISSION_PROFILE = "kota-native";

export function resolveCodexHome(env: NodeJS.ProcessEnv): string {
  const explicitCodexHome = env.CODEX_HOME?.trim();
  if (explicitCodexHome) return explicitCodexHome;
  const home = env.HOME?.trim();
  return join(home || homedir(), ".codex");
}

export function prepareCodexRuntimeEnvironment(
  context: NativeCliRuntimeContext,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const sourceAuthPath = join(resolveCodexHome(env), "auth.json");
  const runtimeHome = join(context.invocationRoot, "codex-home");
  mkdirSync(runtimeHome, { mode: 0o700 });
  if (existsSync(sourceAuthPath)) {
    const destination = join(runtimeHome, "auth.json");
    copyFileSync(sourceAuthPath, destination);
    chmodSync(destination, 0o600);
  }
  writeFileSync(
    join(runtimeHome, "config.toml"),
    codexPermissionProfile(context, runtimeHome),
    { mode: 0o600 },
  );
  return { ...env, CODEX_HOME: runtimeHome };
}

function codexPermissionProfile(
  context: NativeCliRuntimeContext,
  runtimeHome: string,
): string {
  const access = new Map<string, "deny" | "read" | "write">();
  for (const path of context.readableRoots) access.set(path, "read");
  for (const path of context.writableRoots) access.set(path, "write");
  for (const path of context.writeProtectedPaths) access.set(path, "read");
  for (const path of [...context.readProtectedPaths, runtimeHome]) {
    access.set(path, "deny");
  }
  const pathRules = [...access]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, permission]) => `${JSON.stringify(path)} = ${JSON.stringify(permission)}`);
  const workspaceDenials = [
    ...PROTECTED_PROJECT_RUNTIME_FILES,
    ...PROTECTED_PROJECT_ENV_GLOBS,
  ].map((path) => `${JSON.stringify(path)} = "deny"`);
  return [
    `default_permissions = ${JSON.stringify(CODEX_PERMISSION_PROFILE)}`,
    'approval_policy = "untrusted"',
    'web_search = "disabled"',
    "",
    `[permissions.${CODEX_PERMISSION_PROFILE}.filesystem]`,
    '":minimal" = "read"',
    '":tmpdir" = "write"',
    "glob_scan_max_depth = 8",
    ...pathRules,
    "",
    `[permissions.${CODEX_PERMISSION_PROFILE}.filesystem.":workspace_roots"]`,
    '"." = "read"',
    ...workspaceDenials,
    "",
    `[permissions.${CODEX_PERMISSION_PROFILE}.network]`,
    "enabled = false",
    "",
  ].join("\n");
}
