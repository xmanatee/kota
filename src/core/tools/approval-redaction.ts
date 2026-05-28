const SENSITIVE_TOOL_INPUT_KEY_PARTS = new Set([
  "auth",
  "authorization",
  "bearer",
  "cookie",
  "credential",
  "credentials",
  "password",
  "secret",
  "token",
]);

export function isSensitiveToolInputKey(key: string): boolean {
  const normalized = normalizeToolInputKey(key);
  if (normalized.length === 0) return false;
  if (/(?:^|_)api_?key(?:_|$)/.test(normalized)) return true;
  if (/(?:^|_)apikey(?:_|$)/.test(normalized)) return true;
  return normalized
    .split("_")
    .some((part) => SENSITIVE_TOOL_INPUT_KEY_PARTS.has(part));
}

function normalizeToolInputKey(key: string): string {
  return key
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}
