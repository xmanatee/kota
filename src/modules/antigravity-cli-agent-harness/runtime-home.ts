import { homedir } from "node:os";
import { join } from "node:path";
import type { NativeCliRuntimeContext } from "#core/agent-harness/native-cli-sandbox.js";

export const ANTIGRAVITY_CLI_KEYCHAIN_DIR_ENV =
  "KOTA_ANTIGRAVITY_CLI_KEYCHAIN_DIR";

export function resolveAntigravityCliKeychainDirectory(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform !== "darwin") return undefined;
  const explicit = env[ANTIGRAVITY_CLI_KEYCHAIN_DIR_ENV]?.trim();
  if (explicit) return explicit;
  return join(env.HOME?.trim() || homedir(), "Library", "Keychains");
}

export function prepareAntigravityCliRuntimeEnvironment(
  _context: NativeCliRuntimeContext,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const keychainDirectory = resolveAntigravityCliKeychainDirectory(env);
  const prepared = { ...env };
  delete prepared[ANTIGRAVITY_CLI_KEYCHAIN_DIR_ENV];
  if (keychainDirectory === undefined) return prepared;

  throw new Error(
    'The "antigravity-cli" agent harness cannot safely project the macOS ' +
      "Keychains directory into AGY's auto-approved native tool process tree. " +
      "A provider-only authentication broker or an invocation-local AGY-only " +
      "credential store is required; refusing to launch before AGY or " +
      "repository-controlled content can start.",
  );
}
