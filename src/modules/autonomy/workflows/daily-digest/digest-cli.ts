/**
 * `kota digest` — terminal counterpart to the Telegram `/digest` command.
 *
 * Both surfaces consume the on-demand seam (`renderOnDemandDigest`) so the
 * rolled-up body never drifts between operator surfaces. The command is
 * read-only against the scope directory: it does not write the cadence
 * state and does not emit `workflow.daily.digest`. Per the
 * no-cost-bias-in-autonomy contract, this output is operator-facing only and
 * is not exposed to autonomy agents.
 */

import { Command } from "commander";
import { plain, text } from "#modules/rendering/primitives.js";
import { print, writeJson } from "#modules/rendering/transport.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";

export function buildDigestCommand(ctx: { client: Pick<KotaClient, "autonomy"> }): Command {
  return new Command("digest")
    .description(
      "Print the on-demand operator digest for the current scope (24h rollup)",
    )
    .option(
      "--json",
      "Emit the structured DailyDigestData payload as JSON instead of the rendered text body",
    )
    .action(async (opts: { json?: boolean }) => {
      const result = await ctx.client.autonomy.digest();
      if (opts.json) {
        writeJson(result.data, { pretty: true });
        return;
      }
      print(text(plain(result.text)));
    });
}
