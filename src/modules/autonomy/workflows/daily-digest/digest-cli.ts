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

import { join } from "node:path";
import { Command } from "commander";
import { resolveScopeRoot } from "#core/config/scope-root.js";
import { plain, text } from "#modules/rendering/primitives.js";
import { print, writeJson } from "#modules/rendering/transport.js";
import { renderOnDemandDigest } from "./on-demand.js";

export function buildDigestCommand(): Command {
  return new Command("digest")
    .description(
      "Print the on-demand operator digest for the current scope (24h rollup)",
    )
    .option(
      "--json",
      "Emit the structured DailyDigestData payload as JSON instead of the rendered text body",
    )
    .action((opts: { json?: boolean }) => {
      const scopeRoot = resolveScopeRoot();
      const result = renderOnDemandDigest({
        scopeRoot,
        stateDir: join(scopeRoot, ".kota"),
      });
      if (opts.json) {
        writeJson(result.data, { pretty: true });
        return;
      }
      print(text(plain(result.text)));
    });
}
