const SENSITIVE_TOOL_INPUT_KEY_PARTS = new Set([
  "auth",
  "authorization",
  "bearer",
  "cookie",
  "credential",
  "credentials",
  "pass",
  "password",
  "passphrase",
  "passcode",
  "secret",
  "token",
]);

const CONVENTIONAL_SENSITIVE_TOOL_INPUT_KEYS = new Set([
  "mysql_pwd",
  "pgpassword",
]);

const REVIEWABLE_CREDENTIAL_DESTINATION_SUFFIXES = new Set([
  "endpoint",
  "uri",
  "url",
]);

const SENSITIVE_TOOL_INPUT_KEY_PATTERNS = [
  /(?:^|_)api_?key(?:_|$)/,
  /(?:^|_)apikey(?:_|$)/,
  /(?:^|_)access_key(?:_id)?(?:_|$)/,
  /(?:^|_)private_key(?:_|$)/,
  /(?:^|_)secret_key(?:_|$)/,
  /(?:^|_)client_secret(?:_|$)/,
  /(?:^|_)signing_key(?:_|$)/,
  /(?:^|_)encryption_key(?:_|$)/,
];

export function isSensitiveToolInputKey(key: string): boolean {
  const normalized = normalizeToolInputKey(key);
  if (normalized.length === 0) return false;
  if (CONVENTIONAL_SENSITIVE_TOOL_INPUT_KEYS.has(normalized)) return true;
  const parts = normalized.split("_");
  if (
    parts.some((part) => SENSITIVE_TOOL_INPUT_KEY_PARTS.has(part))
    && REVIEWABLE_CREDENTIAL_DESTINATION_SUFFIXES.has(parts.at(-1) ?? "")
  ) {
    return false;
  }
  if (SENSITIVE_TOOL_INPUT_KEY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  return parts.some((part) => SENSITIVE_TOOL_INPUT_KEY_PARTS.has(part));
}

function normalizeToolInputKey(key: string): string {
  return key
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}
