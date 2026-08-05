import { join } from "node:path";
import { withAutomationProcessEnv } from "#core/util/automation-process-env.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";

const REQUIRED_EXECUTABLE_ENV_KEYS = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
] as const;

const LOCALE_ENV_KEYS = new Set([
  "LANG",
  "LANGUAGE",
  "TZ",
]);

const ISOLATED_LOCATION_ENV_KEYS = new Set([
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_RUNTIME_DIR",
]);

const CREDENTIAL_ENV_KEY =
  /(?:^|_)(?:API_?KEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_?KEY|CREDENTIALS?|AUTH|COOKIE|SESSION)(?:_|$)/i;

export type NativeCliEnvironmentOptions = {
  inheritedEnv?: NodeJS.ProcessEnv;
  overrides?: Readonly<Record<string, string>>;
  projectedEnvKeys?: readonly string[];
  authenticationEnvKeys?: readonly string[];
  blockedEnvKeys?: readonly string[];
};

function copyInheritedValue(
  destination: NodeJS.ProcessEnv,
  source: NodeJS.ProcessEnv,
  key: string,
): void {
  const value = source[key];
  if (value !== undefined) destination[key] = value;
}

function assertProjectedCredentialIsDeclared(
  key: string,
  authenticationEnvKeys: ReadonlySet<string>,
): void {
  if (CREDENTIAL_ENV_KEY.test(key) && !authenticationEnvKeys.has(key)) {
    throw new Error(
      `Native CLI child environment rejected credential-shaped environment variable "${key}" because the harness did not declare it as authentication material.`,
    );
  }
}

/**
 * Builds the pre-isolation environment shared by native CLI adapters. The
 * daemon environment is data with a deny-by-default projection: executable
 * lookup, locale, explicitly declared login material, and explicit per-run
 * additions are the only inputs that cross the process boundary.
 */
export function buildNativeCliEnvironment(
  options: NativeCliEnvironmentOptions = {},
): NodeJS.ProcessEnv {
  const inheritedEnv = options.inheritedEnv ?? process.env;
  const authenticationEnvKeys = new Set(options.authenticationEnvKeys ?? []);
  const blockedEnvKeys = new Set(options.blockedEnvKeys ?? []);
  const env: NodeJS.ProcessEnv = {};

  for (const key of REQUIRED_EXECUTABLE_ENV_KEYS) {
    copyInheritedValue(env, inheritedEnv, key);
  }
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (
      value !== undefined &&
      (LOCALE_ENV_KEYS.has(key) || key.startsWith("LC_"))
    ) {
      env[key] = value;
    }
  }

  const projectedEnvKeys = new Set([
    ...(options.projectedEnvKeys ?? []),
    ...authenticationEnvKeys,
  ]);
  for (const key of projectedEnvKeys) {
    if (
      ISOLATED_LOCATION_ENV_KEYS.has(key) ||
      blockedEnvKeys.has(key)
    ) {
      continue;
    }
    assertProjectedCredentialIsDeclared(key, authenticationEnvKeys);
    copyInheritedValue(env, inheritedEnv, key);
  }

  for (const [key, value] of Object.entries(options.overrides ?? {})) {
    if (
      ISOLATED_LOCATION_ENV_KEYS.has(key) ||
      blockedEnvKeys.has(key)
    ) {
      continue;
    }
    assertProjectedCredentialIsDeclared(key, authenticationEnvKeys);
    env[key] = value;
  }

  return withAutomationProcessEnv(withProtectedGitBareRepositoryEnv(env));
}

/** Defines invocation-scoped host-user and temporary-directory locators. */
export function buildIsolatedNativeCliEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  invocationRoot: string,
): NodeJS.ProcessEnv {
  const home = join(invocationRoot, "home");
  const env: NodeJS.ProcessEnv = {
    ...baseEnvironment,
    HOME: home,
    USERPROFILE: home,
    TMPDIR: invocationRoot,
    TMP: invocationRoot,
    TEMP: invocationRoot,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_RUNTIME_DIR: join(invocationRoot, "runtime"),
  };
  delete env.HOMEDRIVE;
  delete env.HOMEPATH;
  return withAutomationProcessEnv(withProtectedGitBareRepositoryEnv(env));
}
