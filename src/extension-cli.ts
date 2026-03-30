import type { Command } from "commander";
import { loadConfig } from "./config.js";
import { discoverExtensions } from "./extension-discovery.js";
import { ExtensionLoader, type ExtensionSummary } from "./extension-loader.js";
import { builtinExtensions } from "./extensions/index.js";

async function loadSummaries(): Promise<ExtensionSummary[]> {
  const config = loadConfig();
  const loader = new ExtensionLoader(config);
  const discovered = await discoverExtensions(undefined, false);
  await loader.loadAll([...builtinExtensions, ...discovered]);
  return loader.getExtensionSummaries();
}

export function registerExtensionCommands(program: Command): void {
  const extCmd = program
    .command("extension")
    .alias("ext")
    .description("Inspect loaded extensions and their contributions");

  extCmd
    .command("list")
    .description("List all loaded extensions with contribution counts")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const summaries = await loadSummaries();
      if (opts.json) {
        console.log(JSON.stringify(summaries, null, 2));
        return;
      }
      if (summaries.length === 0) {
        console.log("No extensions loaded.");
        return;
      }
      const nameWidth = Math.max(...summaries.map((s) => s.name.length), 4);
      const header =
        `${"Name".padEnd(nameWidth)}  ${"Ver".padEnd(7)}  ${"Tools".padStart(5)}  ${"Wf".padStart(3)}  ${"Cmd".padStart(3)}  ${"Ch".padStart(3)}  ${"Sk".padStart(3)}  ${"Ag".padStart(3)}  Description`;
      console.log(header);
      console.log("-".repeat(header.length + 8));
      for (const s of summaries) {
        const ver = (s.version ?? "").padEnd(7);
        const tools = String(s.toolNames.length).padStart(5);
        const wf = String(s.workflowNames.length).padStart(3);
        const cmd = String(s.commandNames.length).padStart(3);
        const ch = String(s.channelNames.length).padStart(3);
        const sk = String(s.skillNames.length).padStart(3);
        const ag = String(s.agentNames.length).padStart(3);
        const desc = s.description ?? "";
        console.log(
          `${s.name.padEnd(nameWidth)}  ${ver}  ${tools}  ${wf}  ${cmd}  ${ch}  ${sk}  ${ag}  ${desc}`,
        );
      }
      console.log(`\n${summaries.length} extension(s) loaded.`);
    });

  extCmd
    .command("inspect <name>")
    .description("Show full detail for one extension")
    .option("--json", "Output as JSON")
    .action(async (name: string, opts: { json?: boolean }) => {
      const summaries = await loadSummaries();
      const ext = summaries.find((s) => s.name === name);
      if (!ext) {
        const names = summaries.map((s) => s.name).join(", ");
        console.error(`Extension "${name}" not found. Loaded: ${names || "(none)"}`);
        process.exit(1);
      }
      if (opts.json) {
        console.log(JSON.stringify(ext, null, 2));
        return;
      }
      console.log(`Extension: ${ext.name}`);
      if (ext.version) console.log(`Version:   ${ext.version}`);
      if (ext.description) console.log(`Description: ${ext.description}`);
      if (ext.dependencies.length > 0) {
        console.log(`Depends on: ${ext.dependencies.join(", ")}`);
      }
      printSection("Tools", ext.toolNames);
      printSection("Workflows", ext.workflowNames);
      printSection("Commands", ext.commandNames);
      printSection("Routes", ext.routeSummaries);
      printSection("Channels", ext.channelNames);
      printSection("Skills", ext.skillNames);
      printSection("Agents", ext.agentNames);
    });
}

function printSection(label: string, items: string[]): void {
  if (items.length === 0) return;
  console.log(`\n${label} (${items.length}):`);
  for (const item of items) console.log(`  • ${item}`);
}
