import type { ToolRunnerContext } from "#core/tools/index.js";

function isKotaOwnedInheritedEnv(key: string): boolean {
  return (
    key === "KOTA_SESSION_ID" ||
    key === "KOTA_TOOL_USE_ID" ||
    key.startsWith("OTEL_") ||
    key.startsWith("OTLP_")
  );
}

export function buildExecutionEnv(
  context?: ToolRunnerContext,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || isKotaOwnedInheritedEnv(key)) continue;
    env[key] = value;
  }
  if (context?.sessionId) env.KOTA_SESSION_ID = context.sessionId;
  if (context?.toolUseId) env.KOTA_TOOL_USE_ID = context.toolUseId;
  return env;
}
