/**
 * `kota digest` — terminal counterpart to the Telegram `/digest` command.
 *
 * Both surfaces consume the on-demand seam (`renderOnDemandDigest`) so the
 * rolled-up body never drifts between operator surfaces. The command is
 * read-only against the project directory: it does not write the cadence
 * snapshot file and does not emit `workflow.daily.digest`. Per the
 * no-cost-bias-in-autonomy contract, this output is operator-facing only and
 * is not exposed to autonomy agents.
 */

import { Command } from "commander";
import { resolveProjectDir } from "#core/config/project-dir.js";
import { plain, text } from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import { renderOnDemandDigest } from "./on-demand.js";

export function buildDigestCommand(): Command {
  return new Command("digest")
    .description(
      "Print the on-demand operator digest for the current project (24h rollup)",
    )
    .option(
      "--json",
      "Emit the structured DailyDigestData payload as JSON instead of the rendered text body",
    )
    .action((opts: { json?: boolean }) => {
      const projectDir = resolveProjectDir();
      const result = renderOnDemandDigest({ projectDir });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result.data, null, 2)}\n`);
        return;
      }
      print(text(plain(result.text)));
    });
}
