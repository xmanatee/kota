/**
 * Architect module — optional two-pass plan-then-edit flow that runs before
 * the main agent loop when enabled via config.
 *
 * Opt-in: set `modules.architect.enabled = true` in the project or global
 * KOTA config (the `-a` / `--architect` CLI flag toggles this for the
 * current invocation). When disabled, the module contributes nothing to
 * session execution.
 */

import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { runArchitectStep } from "./runner.js";

type ArchitectModuleConfig = {
  enabled?: boolean;
};

const architectModule: KotaModule = {
  name: "architect",
  version: "1.0.0",
  description: "Two-pass plan-then-edit pipeline for complex task execution",

  onLoad: (ctx: ModuleContext) => {
    const moduleConfig = ctx.getModuleConfig<ArchitectModuleConfig>();
    if (!moduleConfig?.enabled) return;

    ctx.registerPreSendHook("architect", async (sendCtx) => {
      const result = await runArchitectStep({
        client: sendCtx.client,
        model: sendCtx.model,
        editorModel: sendCtx.editorModel,
        maxTokens: sendCtx.maxTokens,
        effectiveMaxTokens: sendCtx.effectiveMaxTokens,
        systemContext: sendCtx.systemContext,
        messages: sendCtx.messages,
        costTracker: sendCtx.costTracker,
        verbose: sendCtx.verbose,
        thinkingConfig: sendCtx.thinkingConfig,
        transport: sendCtx.transport,
      });
      if (!result) return null;
      return {
        lastResult: result.lastResult,
        assistantText: result.summary,
        userFollowup:
          "The architect/editor has made changes. " +
          "Verify they are correct: run builds, tests, or type checks as appropriate.",
        modifiedFiles: result.modifiedFiles,
      };
    });

    ctx.log.info("Architect/Editor pre-send hook registered");
  },
};

export default architectModule;
