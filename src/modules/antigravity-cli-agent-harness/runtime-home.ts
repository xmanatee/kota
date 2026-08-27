import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { NativeCliRuntimeContext } from "#core/agent-harness/native-cli-sandbox.js";

export const ANTIGRAVITY_CLI_KEYCHAIN_PATH_ENV =
  "KOTA_ANTIGRAVITY_CLI_KEYCHAIN_PATH";

export function resolveAntigravityCliKeychainPath(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform !== "darwin") return undefined;
  const explicit = env[ANTIGRAVITY_CLI_KEYCHAIN_PATH_ENV]?.trim();
  if (explicit) return explicit;
  return join(
    env.HOME?.trim() || homedir(),
    "Library",
    "Keychains",
    "login.keychain-db",
  );
}

export function prepareAntigravityCliRuntimeEnvironment(
  context: NativeCliRuntimeContext,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const keychainPath = resolveAntigravityCliKeychainPath(env);
  const prepared = { ...env };
  delete prepared[ANTIGRAVITY_CLI_KEYCHAIN_PATH_ENV];
  if (keychainPath === undefined) return prepared;
  if (!existsSync(keychainPath)) {
    throw new Error(`Antigravity CLI login keychain does not exist: ${keychainPath}`);
  }

  const keychainDirectory = join(
    context.toolRuntimeRoot,
    "home",
    "Library",
    "Keychains",
  );
  mkdirSync(keychainDirectory, { recursive: true, mode: 0o700 });
  symlinkSync(keychainPath, join(keychainDirectory, "login.keychain-db"), "file");
  return prepared;
}
