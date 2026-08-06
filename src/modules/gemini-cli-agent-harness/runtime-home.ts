import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { NativeCliRuntimeContext } from "#core/agent-harness/native-cli-sandbox.js";

export const GEMINI_CLI_HOME_ENV = "GEMINI_CLI_HOME";
export const GEMINI_FORCE_FILE_STORAGE_ENV = "GEMINI_FORCE_FILE_STORAGE";
export const GEMINI_CLI_SYSTEM_SETTINGS_PATH_ENV =
  "GEMINI_CLI_SYSTEM_SETTINGS_PATH";
export const GEMINI_CLI_SYSTEM_DEFAULTS_PATH_ENV =
  "GEMINI_CLI_SYSTEM_DEFAULTS_PATH";

const GEMINI_CLI_AUTH_ENV_KEYS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
] as const;
const GEMINI_CLI_AUTH_FILES = [
  "oauth_creds.json",
  "google_accounts.json",
] as const;
export const GEMINI_CLI_API_KEY_AUTH_TYPE = "gemini-api-key";

const KOTA_GEMINI_SYSTEM_SETTINGS = {
  admin: {
    secureModeEnabled: true,
    extensions: { enabled: false },
    mcp: { enabled: false, config: {}, requiredConfig: {} },
    skills: { enabled: false },
  },
  advanced: { ignoreLocalEnv: true },
  security: {
    blockGitExtensions: true,
    environmentVariableRedaction: {
      enabled: true,
      allowed: [],
      blocked: [GEMINI_CLI_HOME_ENV, ...GEMINI_CLI_AUTH_ENV_KEYS],
    },
  },
} as const;

export type GeminiCliSettings = {
  selectedAuthType?: string;
  security?: {
    auth?: {
      selectedType?: string;
    };
  };
};

export function resolveGeminiCliHome(
  env: NodeJS.ProcessEnv,
): string {
  return env[GEMINI_CLI_HOME_ENV]?.trim()
    || env.HOME?.trim()
    || homedir();
}

export function resolveGeminiCliAuthDirectory(
  env: NodeJS.ProcessEnv,
): string {
  return join(resolveGeminiCliHome(env), ".gemini");
}

function readGeminiCliSettings(source: string): GeminiCliSettings | null {
  if (!existsSync(source)) return null;
  return JSON.parse(readFileSync(source, "utf8")) as GeminiCliSettings;
}

export function geminiCliSettingsSelectApiKey(
  settings: GeminiCliSettings,
): boolean {
  return settings.selectedAuthType === GEMINI_CLI_API_KEY_AUTH_TYPE ||
    settings.security?.auth?.selectedType === GEMINI_CLI_API_KEY_AUTH_TYPE;
}

function isolatedAuthSettings(
  settings: GeminiCliSettings | null,
): GeminiCliSettings | null {
  if (settings === null) return null;
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

function credentialBearingInputs(
  sourceDirectory: string,
  env: NodeJS.ProcessEnv,
  settings: GeminiCliSettings | null,
): string[] {
  return [
    ...GEMINI_CLI_AUTH_ENV_KEYS.filter((key) => env[key]?.trim()),
    ...GEMINI_CLI_AUTH_FILES.filter((filename) =>
      existsSync(join(sourceDirectory, filename))
    ),
    ...(settings !== null && geminiCliSettingsSelectApiKey(settings)
      ? ["settings.json (gemini-api-key selection)"]
      : []),
  ];
}

/**
 * Builds a KOTA-owned Gemini home without projecting provider credentials.
 * Credential-bearing launches stay disabled until provider authentication can
 * be brokered outside Gemini's native process tree.
 */
export function prepareGeminiCliRuntimeEnvironment(
  context: NativeCliRuntimeContext,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const sourceDirectory = resolveGeminiCliAuthDirectory(env);
  const sourceSettings = readGeminiCliSettings(
    join(sourceDirectory, "settings.json"),
  );
  const credentialInputs = credentialBearingInputs(
    sourceDirectory,
    env,
    sourceSettings,
  );
  if (credentialInputs.length > 0) {
    throw new Error(
      'The "gemini-cli" agent harness cannot safely project provider credentials ' +
        `(${credentialInputs.join(", ")}) into Gemini's native tool process tree. ` +
        "A provider-only authentication broker is required; refusing to launch " +
        "before Gemini or repository-controlled configuration can start.",
    );
  }
  const runtimeHome = join(context.invocationRoot, "gemini-provider-home");
  const runtimeDirectory = join(runtimeHome, ".gemini");
  mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
  const settings = isolatedAuthSettings(sourceSettings);
  if (settings !== null) {
    const destination = join(runtimeDirectory, "settings.json");
    writeFileSync(destination, JSON.stringify(settings), { mode: 0o600 });
  }
  const systemSettingsPath = join(
    context.protectedRuntimeRoot,
    "kota-system-settings.json",
  );
  const systemDefaultsPath = join(
    context.protectedRuntimeRoot,
    "kota-system-defaults.json",
  );
  writeFileSync(
    systemSettingsPath,
    JSON.stringify(KOTA_GEMINI_SYSTEM_SETTINGS),
    { mode: 0o600 },
  );
  writeFileSync(systemDefaultsPath, "{}", { mode: 0o600 });
  return {
    ...env,
    [GEMINI_CLI_HOME_ENV]: runtimeHome,
    [GEMINI_FORCE_FILE_STORAGE_ENV]: "true",
    [GEMINI_CLI_SYSTEM_SETTINGS_PATH_ENV]: systemSettingsPath,
    [GEMINI_CLI_SYSTEM_DEFAULTS_PATH_ENV]: systemDefaultsPath,
  };
}
