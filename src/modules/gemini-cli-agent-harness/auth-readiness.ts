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

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readJsonFile<T>(path: string): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, "utf-8")) as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function hasUsableOAuthCreds(creds: GeminiOAuthCreds): boolean {
  if (isNonEmptyString(creds.refresh_token)) return true;
  if (!isNonEmptyString(creds.access_token)) return false;
  if (creds.expiry_date === undefined) return true;
  const expiry =
    typeof creds.expiry_date === "number"
      ? creds.expiry_date
      : Number.parseInt(creds.expiry_date, 10);
  return Number.isFinite(expiry) && expiry > Date.now();
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

export function geminiCliAuthReadiness(): AgentHarnessAuthProbe {
  const geminiDir = join(homedir(), ".gemini");
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
    if (hasUsableOAuthCreds(parsed.value)) {
      return {
        kind: "harness-managed-login",
        status: "ready",
        required: true,
        command: "gemini",
        detail: "cached OAuth credentials found at ~/.gemini/oauth_creds.json",
        summary: "Gemini CLI Google login cached",
      };
    }
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
        detail: "active Gemini CLI Google account metadata found at ~/.gemini/google_accounts.json",
        summary: "Gemini CLI Google account cached",
      };
    }
  }

  return {
    kind: "harness-managed-login",
    status: "missing",
    required: true,
    command: "gemini",
    detail: "no cached Gemini CLI Google OAuth / Code Assist credentials found under ~/.gemini",
    summary: "Gemini CLI login not active; run `gemini` and sign in",
  };
}
