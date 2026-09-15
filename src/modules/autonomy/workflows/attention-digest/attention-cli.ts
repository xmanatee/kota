/**
 * `kota attention` — terminal counterpart to the Telegram `/attention`
 * command.
 *
 * Both surfaces consume `renderOnDemandAttention` so the rendered body never
 * drifts between operator surfaces. The command is read-only against the
 * scope directory: it does not advance the runtime-owned attention snapshot or emit
 * `workflow.attention.digest`. Per the no-cost-bias-in-autonomy contract,
 * this output is operator-facing only and is not exposed to autonomy agents.
 */

import { Command } from "commander";
import { resolveScopeRoot } from "#core/config/scope-root.js";
import { createAutonomyClient } from "#modules/autonomy/client.js";
import { plain, text } from "#modules/rendering/primitives.js";
import { print, writeJson } from "#modules/rendering/transport.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";

export function buildAttentionCommand(ctx: { client: Pick<KotaClient, "autonomy"> }): Command {
  return new Command("attention")
    .description(
      "Print current attention items without consuming automated alerts",
    )
    .option(
      "--json",
      "Emit the structured AttentionItem[] payload (and rendered text) as JSON instead of the rendered text body",
    )
    .option("--state-dir <path>", "Read an explicit offline daemon state directory")
    .action(async (opts: { json?: boolean; stateDir?: string }) => {
      const client = opts.stateDir === undefined
        ? ctx.client.autonomy
        : createAutonomyClient(resolveScopeRoot(), opts.stateDir);
      const result = await client.attention();
      if (opts.json) {
        writeJson({ items: result.data.items, text: result.text }, { pretty: true });
        return;
      }
      print(text(plain(result.text)));
    });
}
