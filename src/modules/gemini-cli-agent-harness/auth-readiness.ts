import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentHarnessAuthProbe } from "#core/agent-harness/index.js";

type GeminiOAuthCreds = {
  readonly access_token?: string;
  readonly refresh_token?: string;
};

type GeminiGoogleAccounts = {
  readonly active?: string | { readonly email?: string } | null;
};

export type GeminiCliAuthReadinessOptions = {
  readonly geminiDir?: string;
  readonly env?: NodeJS.ProcessEnv;
};

const GEMINI_CLI_AUTH_ENV_KEYS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
] as const;
const GEMINI_CLI_BROKER_REQUIRED_SUMMARY =
  "Gemini CLI provider auth broker unavailable";

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readJsonFile<T>(
  path: string,
): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, "utf-8")) as T };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function oauthCredsReadiness(
  creds: GeminiOAuthCreds,
): AgentHarnessAuthProbe | null {
  if (
    !isNonEmptyString(creds.refresh_token) &&
    !isNonEmptyString(creds.access_token)
  ) return null;
  return {
    kind: "harness-managed-login",
    status: "error",
    required: true,
    command: "gemini",
    detail:
      "cached Gemini CLI OAuth credentials were detected, but KOTA cannot " +
      "project them into the native tool process tree without a provider-only broker",
    summary: GEMINI_CLI_BROKER_REQUIRED_SUMMARY,
  };
}

function activeAccountLabel(accounts: GeminiGoogleAccounts): string | null {
  if (typeof accounts.active === "string" && accounts.active.trim()) {
    return accounts.active.trim();
  }
  if (
    accounts.active &&
    typeof accounts.active === "object" &&
    isNonEmptyString(accounts.active.email)
  ) {
    return accounts.active.email;
  }
  return null;
}

export function geminiCliAuthReadiness(
  options: GeminiCliAuthReadinessOptions = {},
): AgentHarnessAuthProbe {
  const geminiDir = options.geminiDir ?? join(homedir(), ".gemini");
  const credentialEnvKeys = GEMINI_CLI_AUTH_ENV_KEYS.filter((key) =>
    isNonEmptyString((options.env ?? process.env)[key])
  );
  if (credentialEnvKeys.length > 0) {
    return {
      kind: "harness-managed-login",
      status: "error",
      required: true,
      command: "gemini",
      detail:
        `Gemini provider credential environment detected (${credentialEnvKeys.join(", ")}), ` +
        "but KOTA cannot safely project it without a provider-only broker",
      summary: GEMINI_CLI_BROKER_REQUIRED_SUMMARY,
    };
  }
  const oauthPath = join(geminiDir, "oauth_creds.json");
  if (existsSync(oauthPath)) {
    const parsed = readJsonFile<GeminiOAuthCreds>(oauthPath);
    if (!parsed.ok) {
      return {
        kind: "harness-managed-login",
        status: "error",
        required: true,
        command: "gemini",
        detail: `failed to read cached Gemini CLI OAuth credentials: ${parsed.error}`,
        summary: "Gemini CLI cached auth probe failed",
      };
    }
    const oauthReadiness = oauthCredsReadiness(parsed.value);
    if (oauthReadiness !== null) return oauthReadiness;
  }

  const accountsPath = join(geminiDir, "google_accounts.json");
  if (existsSync(accountsPath)) {
    const parsed = readJsonFile<GeminiGoogleAccounts>(accountsPath);
    if (!parsed.ok) {
      return {
        kind: "harness-managed-login",
        status: "error",
        required: true,
        command: "gemini",
        detail: `failed to read cached Gemini CLI account metadata: ${parsed.error}`,
        summary: "Gemini CLI account probe failed",
      };
    }
    const active = activeAccountLabel(parsed.value);
    if (active) {
      return {
        kind: "harness-managed-login",
        status: "error",
        required: true,
        command: "gemini",
        detail:
          "active Gemini CLI account metadata was detected, but KOTA cannot " +
          "project provider auth without a provider-only broker",
        summary: GEMINI_CLI_BROKER_REQUIRED_SUMMARY,
      };
    }
  }

  return {
    kind: "harness-managed-login",
    status: "missing",
    required: true,
    command: "gemini",
    detail:
      "no brokered Gemini CLI provider authentication is available",
    summary: "Gemini CLI provider auth broker unavailable",
  };
}
