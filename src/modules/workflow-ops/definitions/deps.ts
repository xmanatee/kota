import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { getWorkflowDefinitions } from "../definitions-source.js";
import {
  assembleWorkflowGraph,
  formatCompact,
  formatDot,
  formatTable,
} from "../graph/index.js";

export function registerDepsCommand(
  wfCmd: Command,
  ctx: ModuleContext,
): void {
  wfCmd
    .command("deps")
    .description(
      "Show workflow trigger dependency graph — which events trigger which workflows, what they emit, and which agents they use",
    )
    .option(
      "--format <format>",
      "Output format: table (default), compact, dot (Graphviz DOT), or json",
      "table",
    )
    .action((opts: { format: string }) => {
      const definitions = getWorkflowDefinitions(ctx);
      if (definitions.length === 0) {
        console.log("No workflow definitions loaded.");
        return;
      }

      const graph = assembleWorkflowGraph(definitions);

      switch (opts.format) {
        case "table":
          console.log(formatTable(graph));
          break;
        case "compact":
          console.log(formatCompact(graph));
          break;
        case "dot":
          console.log(formatDot(graph));
          break;
        case "json":
          console.log(JSON.stringify(graph, null, 2));
          break;
        default:
          console.error(
            `Unknown format "${opts.format}". Use "table", "compact", "dot", or "json".`,
          );
          process.exit(1);
      }
    });
}
