/**
 * `kota attention` — terminal counterpart to the Telegram `/attention`
 * command.
 *
 * Both surfaces consume `renderOnDemandAttention` so the rendered body never
 * drifts between operator surfaces. The command is read-only against the
 * project directory: it does not advance the cadence counter at
 * `<runsDir>/../attention-digest-counter.json` and does not emit
 * `workflow.attention.digest`. Per the no-cost-bias-in-autonomy contract,
 * this output is operator-facing only and is not exposed to autonomy agents.
 */

import { join } from "node:path";
import { Command } from "commander";
import { resolveProjectDir } from "#core/config/project-dir.js";
import { plain, text } from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import { renderOnDemandAttention } from "./step.js";

export function buildAttentionCommand(): Command {
  return new Command("attention")
    .description(
      "Print the on-demand attention items for the current project (no cadence side effects)",
    )
    .option(
      "--json",
      "Emit the structured AttentionItem[] payload (and rendered text) as JSON instead of the rendered text body",
    )
    .action((opts: { json?: boolean }) => {
      const projectDir = resolveProjectDir();
      const runsDir = join(projectDir, ".kota", "runs");
      const result = renderOnDemandAttention({ projectDir, runsDir });
      if (opts.json) {
        process.stdout.write(
          `${JSON.stringify({ items: result.items, text: result.text }, null, 2)}\n`,
        );
        return;
      }
      print(text(plain(result.text)));
    });
}
