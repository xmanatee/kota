import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentHarnessAuthProbe } from "#core/agent-harness/index.js";

type GeminiOAuthCreds = {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly expiry_date?: number | string;
};

type GeminiGoogleAccounts = {
  readonly active?: string | { readonly email?: string } | null;
};

export type GeminiCliAuthReadinessOptions = {
  readonly geminiDir?: string;
  readonly now?: () => Date;
};

const NON_REFRESHABLE_ACCESS_TOKEN_WARNING_MS = 60 * 60 * 1000;
const GEMINI_RENEWAL_SUMMARY =
  "run `gemini` and sign in again before unattended runs";

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

function parseExpiryDate(value: number | string | undefined): number | null {
  if (value === undefined) return null;
  const expiry =
    typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(expiry) ? expiry : null;
}

function oauthExpiryIso(expiryMs: number): string {
  return new Date(expiryMs).toISOString();
}

function oauthCredsReadiness(
  creds: GeminiOAuthCreds,
  nowMs: number,
): AgentHarnessAuthProbe | null {
  if (isNonEmptyString(creds.refresh_token)) {
    return {
      kind: "harness-managed-login",
      status: "ready",
      required: true,
      command: "gemini",
      detail:
        "cached OAuth refresh token found at ~/.gemini/oauth_creds.json",
      summary: "Gemini CLI Google login cached with refresh token",
    };
  }
  if (!isNonEmptyString(creds.access_token)) return null;
  if (creds.expiry_date === undefined) {
    return {
      kind: "harness-managed-login",
      status: "ready",
      required: true,
      command: "gemini",
      detail:
        "cached OAuth access token found at ~/.gemini/oauth_creds.json",
      summary: "Gemini CLI Google login cached",
    };
  }

  const expiry = parseExpiryDate(creds.expiry_date);
  if (expiry === null) {
    return {
      kind: "harness-managed-login",
      status: "error",
      required: true,
      command: "gemini",
      detail:
        "cached Gemini CLI OAuth credentials have an invalid expiry_date",
      summary: "Gemini CLI cached auth probe failed",
    };
  }

  const expiresAt = oauthExpiryIso(expiry);
  if (expiry <= nowMs) {
    return {
      kind: "harness-managed-login",
      status: "stale",
      required: true,
      command: "gemini",
      detail: `cached non-refreshable OAuth access token expired at ${expiresAt}`,
      summary: "Gemini CLI cached auth expired",
      expiredAt: expiresAt,
      renewalSummary: GEMINI_RENEWAL_SUMMARY,
    };
  }
  if (expiry - nowMs <= NON_REFRESHABLE_ACCESS_TOKEN_WARNING_MS) {
    return {
      kind: "harness-managed-login",
      status: "expiring",
      required: true,
      command: "gemini",
      detail: `cached non-refreshable OAuth access token expires at ${expiresAt}`,
      summary: "Gemini CLI Google login expires soon",
      expiresAt,
      renewalSummary: GEMINI_RENEWAL_SUMMARY,
    };
  }
  return {
    kind: "harness-managed-login",
    status: "ready",
    required: true,
    command: "gemini",
    detail: `cached non-refreshable OAuth access token expires at ${expiresAt}`,
    summary: "Gemini CLI Google login cached",
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
  const nowMs = (options.now ?? (() => new Date()))().getTime();
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
    const oauthReadiness = oauthCredsReadiness(parsed.value, nowMs);
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
        status: "ready",
      required: true,
      command: "gemini",
      detail:
        "active Gemini CLI Google account metadata found at ~/.gemini/google_accounts.json",
      summary: "Gemini CLI Google account cached",
    };
  }
  }

  return {
    kind: "harness-managed-login",
    status: "missing",
    required: true,
    command: "gemini",
    detail:
      "no cached Gemini CLI Google OAuth / Code Assist credentials found under ~/.gemini",
    summary: "Gemini CLI login not active; run `gemini` and sign in",
  };
}
