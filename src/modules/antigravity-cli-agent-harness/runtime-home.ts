import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ContainerAuthUnavailableError } from "#core/agent-harness/harness-definition.js";
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

/** Contained login must satisfy the harness contract's native-tool credential
 * exclusion. AGY's headless file-storage fallback alone does not establish it. */
export function resolveAntigravityCliContainerAuth(_env: NodeJS.ProcessEnv): never {
  throw new ContainerAuthUnavailableError(
    "Antigravity contained subscription login projection is not implemented. " +
    "AGY supports headless file-based token storage, but KOTA has not established " +
    "the selected Linux release's login-file location, refresh behavior, and native-tool credential exclusion. " +
    "Use an authorized isolated Linux setup probe or equivalent vendor contract evidence to establish these before implementing the projection. " +
    "A host keychain export or plaintext token mount is not a substitute for that contract. " +
    "GEMINI_API_KEY/GOOGLE_API_KEY do not select subscription login; " +
    "paid API inference additionally requires AGY modelProvider: gemini and is a separate comparison route.",
  );
}
