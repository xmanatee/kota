import { modelProviderSelectionFromConfig } from "#core/model/model-client.js";
import { resolveActivePresetFromConfig } from "#core/model/preset.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { createDelegateBudget } from "#core/tools/delegate-budget.js";
import { runHandoffAgent } from "#core/tools/handoff-agent.js";
import { withHandoffAgentRuntime } from "#core/tools/handoff-agent-runtime.js";
import type {
  InboundSignalAgentTriggerOptions,
  InboundSignalAgentTriggerResult,
} from "./routing.js";

export async function triggerInboundSignalAgent(
  ctx: ModuleContext,
  name: string,
  options: InboundSignalAgentTriggerOptions,
): Promise<InboundSignalAgentTriggerResult> {
  const harness = ctx.config.defaultAgentHarness ?? resolveActivePresetFromConfig(ctx.config).harness;
  const modelProvider = modelProviderSelectionFromConfig(ctx.config);
  const result = await withHandoffAgentRuntime(
    {
      cwd: ctx.cwd,
      harness,
      resolveAgentDef: ctx.resolveAgentDef,
      resolveSkillsPrompt: ctx.resolveSkillsPrompt,
      ...(modelProvider !== undefined ? { modelProvider } : {}),
      ...(ctx.config.modelOutputTokenLimits !== undefined
        ? { modelOutputTokenLimits: ctx.config.modelOutputTokenLimits }
        : {}),
      delegateBudget: createDelegateBudget(),
    },
    () =>
      runHandoffAgent(
        {
          agent: name,
          mode: "call",
          input: options.payload,
          reason: "Inbound signal route matched this registered agent target.",
          autonomy_mode: options.autonomyMode,
          budget: { max_turns: options.maxTurns },
          scope: {
            scope_id: String(options.payload.scopeId),
            project_id: String(options.payload.projectId),
          },
        },
        {
          scopeId: String(options.payload.scopeId),
          projectId: String(options.payload.projectId),
        },
      ),
  );
  if (result.is_error) {
    return { ok: false, reason: result.content };
  }
  const childSessionId = result.structuredContent?.childSessionId;
  return {
    ok: true,
    ...(typeof childSessionId === "string" && childSessionId.length > 0
      ? { sessionId: childSessionId }
      : {}),
  };
}
