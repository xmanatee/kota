import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const GEMINI_CLI_AUTH_DIR_ENV = "KOTA_GEMINI_CLI_AUTH_DIR";

type GeminiCliSettings = {
  selectedAuthType?: string;
  security?: {
    auth?: {
      selectedType?: string;
    };
  };
};

export function resolveGeminiCliAuthDirectory(
  env: NodeJS.ProcessEnv,
): string {
  const explicit = env[GEMINI_CLI_AUTH_DIR_ENV]?.trim();
  if (explicit) return explicit;
  return join(env.HOME?.trim() || homedir(), ".gemini");
}

function copyPrivateFile(source: string, destination: string): void {
  if (!existsSync(source)) return;
  copyFileSync(source, destination);
  chmodSync(destination, 0o600);
}

function isolatedAuthSettings(source: string): GeminiCliSettings | null {
  if (!existsSync(source)) return null;
  const settings = JSON.parse(readFileSync(source, "utf8")) as GeminiCliSettings;
  const selectedAuthType = typeof settings.selectedAuthType === "string"
    ? settings.selectedAuthType
    : undefined;
  const selectedType = typeof settings.security?.auth?.selectedType === "string"
    ? settings.security.auth.selectedType
    : undefined;
  if (selectedAuthType === undefined && selectedType === undefined) return null;
  return {
    ...(selectedAuthType === undefined ? {} : { selectedAuthType }),
    ...(selectedType === undefined
      ? {}
      : { security: { auth: { selectedType } } }),
  };
}

/** Copies only Gemini CLI login state into the invocation-scoped home. */
export function prepareGeminiCliRuntimeEnvironment(
  temporaryDirectory: string,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const sourceDirectory = resolveGeminiCliAuthDirectory(env);
  const runtimeDirectory = join(temporaryDirectory, "home", ".gemini");
  mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
  for (const filename of ["oauth_creds.json", "google_accounts.json"]) {
    copyPrivateFile(
      join(sourceDirectory, filename),
      join(runtimeDirectory, filename),
    );
  }
  const settings = isolatedAuthSettings(join(sourceDirectory, "settings.json"));
  if (settings !== null) {
    const destination = join(runtimeDirectory, "settings.json");
    writeFileSync(destination, JSON.stringify(settings), { mode: 0o600 });
  }
  const prepared = { ...env };
  delete prepared[GEMINI_CLI_AUTH_DIR_ENV];
  return prepared;
}
