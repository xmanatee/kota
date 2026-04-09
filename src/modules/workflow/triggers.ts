import type { Command } from "commander";
import type { ModuleContext } from "../../module-types.js";
import type { WorkflowDefinitionTriggerSummary } from "../../scheduler/daemon-control-types.js";
import { DaemonControlClient } from "../../server/daemon-client.js";
import type { RegisteredWorkflowDefinitionInput } from "../../workflow/types.js";
import { getWorkflowDefinitions } from "./definitions-source.js";

type WatchTriggerRow = {
  workflow: string;
  enabled: boolean;
  patterns: string[];
  debounceMs: number;
};

function collectFromSummary(
  defs: { name: string; enabled: boolean; triggers: WorkflowDefinitionTriggerSummary[] }[],
): WatchTriggerRow[] {
  const rows: WatchTriggerRow[] = [];
  for (const def of defs) {
    for (const t of def.triggers) {
      if (t.type === "watch") {
        rows.push({ workflow: def.name, enabled: def.enabled, patterns: t.patterns, debounceMs: t.debounceMs });
      }
    }
  }
  return rows;
}

function collectFromDefinitions(
  defs: readonly RegisteredWorkflowDefinitionInput[],
): WatchTriggerRow[] {
  const rows: WatchTriggerRow[] = [];
  for (const def of defs) {
    for (const t of def.triggers) {
      if (!t.watch) continue;
      const patterns = Array.isArray(t.watch) ? t.watch : [t.watch];
      rows.push({ workflow: def.name, enabled: def.enabled !== false, patterns, debounceMs: t.debounceMs ?? 500 });
    }
  }
  return rows;
}

export function registerTriggersCommand(
  wfCmd: Command,
  ctx: ModuleContext,
): void {
  wfCmd
    .command("triggers")
    .description("Show active file-watch triggers")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      let rows: WatchTriggerRow[];
      let source: "daemon" | "static" = "static";

      const daemonClient = DaemonControlClient.fromStateDir();
      if (daemonClient) {
        const result = await daemonClient.getWorkflowDefinitions();
        if (result?.definitions) {
          rows = collectFromSummary(result.definitions);
          source = "daemon";
        } else {
          rows = collectFromDefinitions(getWorkflowDefinitions(ctx));
        }
      } else {
        rows = collectFromDefinitions(getWorkflowDefinitions(ctx));
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
      console.log(`\n${rows.length} watch trigger(s). Source: ${source}.`);
    });
}
