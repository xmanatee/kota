import {
  existsSync,
  mkdirSync,
  symlinkSync,
} from "node:fs";
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
  context: NativeCliRuntimeContext,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const keychainDirectory = resolveAntigravityCliKeychainDirectory(env);
  const prepared = { ...env };
  delete prepared[ANTIGRAVITY_CLI_KEYCHAIN_DIR_ENV];
  if (keychainDirectory === undefined) return prepared;
  if (!existsSync(keychainDirectory)) {
    throw new Error(
      `Antigravity CLI keychain directory does not exist: ${keychainDirectory}`,
    );
  }

  const libraryDirectory = join(context.toolRuntimeRoot, "home", "Library");
  mkdirSync(libraryDirectory, { recursive: true, mode: 0o700 });
  symlinkSync(
    keychainDirectory,
    join(libraryDirectory, "Keychains"),
    "dir",
  );
  return prepared;
}
