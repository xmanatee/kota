/**
 * `kota attention` — terminal counterpart to the Telegram `/attention`
 * command.
 *
 * Both surfaces consume `renderOnDemandAttention` so the rendered body never
 * drifts between operator surfaces. The command is read-only against the
 * scope directory: it does not advance runtime-owned cadence state or emit
 * `workflow.attention.digest`. Per the no-cost-bias-in-autonomy contract,
 * this output is operator-facing only and is not exposed to autonomy agents.
 */

import { join } from "node:path";
import { Command } from "commander";
import { resolveScopeRoot } from "#core/config/scope-root.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { plain, text } from "#modules/rendering/primitives.js";
import { print, writeJson } from "#modules/rendering/transport.js";
import { requireWorkflowRunDurableAuthority } from "#modules/workflow-ops/runs/workflow-history.js";
import { renderOnDemandAttention } from "./step.js";

export function buildAttentionCommand(ctx: ModuleContext): Command {
  return new Command("attention")
    .description(
      "Print the on-demand attention items for the current scope (no cadence side effects)",
    )
    .option(
      "--json",
      "Emit the structured AttentionItem[] payload (and rendered text) as JSON instead of the rendered text body",
    )
    .action(async (opts: { json?: boolean }) => {
      const scopeRoot = resolveScopeRoot();
      const runsDir = join(scopeRoot, ".kota", "runs");
      const status = await ctx.client.workflow.status();
      const result = renderOnDemandAttention({
        scopeRoot,
        runsDir,
        authority: requireWorkflowRunDurableAuthority(
          status.authorityCriticalRunIds,
          status.operationallyActiveRunIds,
          status.terminalRunIds,
        ),
      });
      if (opts.json) {
        writeJson({ items: result.items, text: result.text }, { pretty: true });
        return;
      }
      print(text(plain(result.text)));
    });
}
