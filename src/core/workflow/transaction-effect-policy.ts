import type {
  AgentCanUseTool,
  AgentPermissionResult,
} from "#core/agent-harness/index.js";
import type { ToolEffect } from "#core/tools/effect.js";
import { getToolEffect } from "#core/tools/index.js";

/** Effects that remain inside one run and disappear when that run is discarded. */
export function isRunLocalEffect(effect: ToolEffect | undefined): boolean {
  if (effect === undefined) return false;
  return effect.kind === "read" ||
    effect.scope === "local-fs" ||
    effect.scope === "session" ||
    effect.scope === "process-env";
}

/**
 * KOTA-hosted tool loops use the same transaction boundary as declarative and
 * code steps. Unknown names are adapter-native tools governed by the adapter's
 * mandatory process sandbox; every KOTA-registered tool has effect metadata.
 */
export function createWriterAgentEffectGuard(): AgentCanUseTool {
  return async (toolName, input): Promise<AgentPermissionResult> => {
    const effect = getToolEffect(toolName, input);
    if (effect === undefined || isRunLocalEffect(effect)) {
      return { behavior: "allow", updatedInput: input };
    }
    return {
      behavior: "deny",
      message:
        `Repository writer agents cannot perform ${effect.kind} effects on ${effect.scope} before integration. ` +
        "Use a repository:none workflow triggered after successful integration.",
      decisionAttribution: "operator-deny",
    };
  };
}
