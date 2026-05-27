import { buildFilteredInheritedSubprocessEnv } from "#core/modules/subprocess-env.js";
import type { ToolRunnerContext } from "#core/tools/index.js";

export function buildExecutionEnv(
  context?: ToolRunnerContext,
): NodeJS.ProcessEnv {
  const env = buildFilteredInheritedSubprocessEnv();
  if (context?.sessionId) env.KOTA_SESSION_ID = context.sessionId;
  if (context?.toolUseId) env.KOTA_TOOL_USE_ID = context.toolUseId;
  return env;
}
