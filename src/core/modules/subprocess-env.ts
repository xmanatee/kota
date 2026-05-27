export function isKotaOwnedInheritedEnv(key: string): boolean {
  return (
    key === "KOTA_SESSION_ID" ||
    key === "KOTA_TOOL_USE_ID" ||
    key.startsWith("OTEL_") ||
    key.startsWith("OTLP_")
  );
}

export function buildFilteredInheritedSubprocessEnv(
  inheritedEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value === undefined || isKotaOwnedInheritedEnv(key)) continue;
    env[key] = value;
  }
  return env;
}
