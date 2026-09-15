import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathIsWithinRoots } from "#core/agent-harness/machine-authority-sandbox-paths.js";
import type { NativeCliRuntimeContext } from "#core/agent-harness/native-cli-sandbox.js";
import {
  PROTECTED_SCOPE_ENV_GLOBS,
  PROTECTED_SCOPE_RUNTIME_FILES,
} from "#core/tools/protected-scope-paths.js";
import { resolvePathIdentities } from "#core/util/real-path.js";

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
  sessionStorageDir?: string,
  webSearch = false,
): NodeJS.ProcessEnv {
  const sourceAuthPath = join(resolveCodexHome(env), "auth.json");
  const runtimeHome = join(context.invocationRoot, "codex-home");
  mkdirSync(runtimeHome, { mode: 0o700 });
  if (sessionStorageDir !== undefined) {
    for (const name of ["sessions", "archived_sessions"]) {
      const directory = join(sessionStorageDir, name);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      symlinkSync(directory, join(runtimeHome, name), "dir");
    }
  }
  if (existsSync(sourceAuthPath)) {
    const destination = join(runtimeHome, "auth.json");
    copyFileSync(sourceAuthPath, destination);
    chmodSync(destination, 0o600);
  }
  writeFileSync(
    join(runtimeHome, "config.toml"),
    codexPermissionProfile(context, runtimeHome, sourceAuthPath, sessionStorageDir, webSearch),
    { mode: 0o600 },
  );
  return { ...env, CODEX_HOME: runtimeHome };
}

function codexPermissionProfile(
  context: NativeCliRuntimeContext,
  runtimeHome: string,
  sourceAuthPath: string,
  sessionStorageDir?: string,
  webSearch = false,
): string {
  const readProtectedPaths = [
    ...context.readProtectedPaths,
    ...context.readProtectedRoots,
    ...resolvePathIdentities(runtimeHome, process.cwd()),
    ...resolvePathIdentities(sourceAuthPath, process.cwd()),
    ...(sessionStorageDir === undefined ? [] : resolvePathIdentities(sessionStorageDir, process.cwd())),
  ];
  const access = new Map<string, "deny" | "read" | "write">();
  for (const path of context.readableRoots) access.set(path, "read");
  for (const path of context.writableRoots) access.set(path, "write");
  // Write protection narrows existing authority; it cannot authorize new reads.
  const grantedRoots = [...access.keys()];
  for (const path of context.writeProtectedPaths) {
    if (pathIsWithinRoots(path, grantedRoots)) access.set(path, "read");
  }
  for (const path of readProtectedPaths) {
    access.set(path, "deny");
  }
  // A more-specific grant must not reopen a protected directory or token.
  for (const [path, permission] of access) {
    if (pathIsWithinRoots(path, readProtectedPaths)) {
      access.set(path, "deny");
    } else if (permission === "write" && pathIsWithinRoots(path, context.writeProtectedPaths)) {
      access.set(path, "read");
    }
  }
  const pathRules = [...access]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, permission]) => `${JSON.stringify(path)} = ${JSON.stringify(permission)}`);
  const workspaceDenials = [
    ...PROTECTED_SCOPE_RUNTIME_FILES,
    ...PROTECTED_SCOPE_ENV_GLOBS,
  ].map((path) => `${JSON.stringify(path)} = "deny"`);
  return [
    `default_permissions = ${JSON.stringify(CODEX_PERMISSION_PROFILE)}`,
    'approval_policy = "never"',
    `web_search = "${webSearch ? "live" : "disabled"}"`,
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
