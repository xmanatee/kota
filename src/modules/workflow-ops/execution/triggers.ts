import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";

type WatchTriggerRow = {
  workflow: string;
  enabled: boolean;
  patterns: string[];
  debounceMs: number;
};

export function registerTriggersCommand(
  wfCmd: Command,
  ctx: ModuleContext,
): void {
  wfCmd
    .command("triggers")
    .description("Show active file-watch triggers")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const result = await ctx.client.workflow.listDefinitions();
      const rows: WatchTriggerRow[] = [];
      for (const def of result.definitions) {
        for (const trigger of def.triggers) {
          if (trigger.type === "watch") {
            rows.push({
              workflow: def.name,
              enabled: def.enabled,
              patterns: trigger.patterns,
              debounceMs: trigger.debounceMs,
            });
          }
        }
      }

      if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }

      if (rows.length === 0) {
        console.log("No file-watch triggers registered.");
        return;
      }

      const nameWidth = Math.max(...rows.map((r) => r.workflow.length), 8);
      const enWidth = 7;
      console.log(`${"Workflow".padEnd(nameWidth)}  ${"Enabled".padEnd(enWidth)}  Patterns`);
      console.log("-".repeat(nameWidth + enWidth + 30));
      for (const r of rows) {
        const name = r.workflow.padEnd(nameWidth);
        const enabled = (r.enabled ? "yes" : "no").padEnd(enWidth);
        const patterns = r.patterns.join(", ");
        const debounce = r.debounceMs !== 500 ? ` (debounce ${r.debounceMs}ms)` : "";
        console.log(`${name}  ${enabled}  ${patterns}${debounce}`);
      }
      console.log(`\n${rows.length} watch trigger(s). Source: ${result.source}.`);
    });
}
