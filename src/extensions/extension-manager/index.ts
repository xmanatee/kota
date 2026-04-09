import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import type { ExtensionContext, KotaExtension } from "../../extension-types.js";
import { generateExtensionScaffold, generatePythonScaffold } from "./scaffolds.js";

function buildExtensionCommand(ctx: ExtensionContext): Command {
  const extCmd = new Command("extension")
    .alias("ext")
    .description("Inspect loaded extensions and their contributions");

  extCmd
    .command("list")
    .description("List all loaded extensions with contribution counts")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      const summaries = ctx.getExtensionSummaries();
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
    .action((name: string, opts: { json?: boolean }) => {
      const summaries = ctx.getExtensionSummaries();
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
      if (ext.health) {
        const h = ext.health;
        const restartPart = h.restartCount === 0 ? `(${h.restartCount} restarts)` : `(${h.restartCount} restarts, last: ${h.lastRestartAt ?? "unknown"})`;
        console.log(`Health:    ${h.status}  ${restartPart}`);
      }
      printSection("Tools", ext.toolNames);
      printSection("Workflows", ext.workflowNames);
      printSection("Commands", ext.commandNames);
      printSection("Routes", ext.routeSummaries);
      printSection("Channels", ext.channelNames);
      printSection("Skills", ext.skillNames);
      printSection("Agents", ext.agentNames);
    });

  extCmd
    .command("new <name>")
    .description("Scaffold a new extension starter in a new directory")
    .option("--dir <path>", "Target directory (default: ./<name>)")
    .option("--language <lang>", "Scaffold language: typescript (default) or python")
    .action((name: string, opts: { dir?: string; language?: string }) => {
      const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      const targetDir = resolve(opts.dir ?? safeName);
      const language = opts.language ?? "typescript";

      if (language !== "typescript" && language !== "python") {
        console.error(`Error: unsupported language: ${language}. Supported: typescript, python`);
        process.exit(1);
      }

      if (existsSync(targetDir)) {
        console.error(`Error: directory already exists: ${targetDir}`);
        process.exit(1);
      }

      if (language === "python") {
        generatePythonScaffold(name, safeName, targetDir);
        console.log(`Python extension scaffold created at: ${targetDir}`);
        console.log("");
        console.log("Next steps:");
        console.log(`  cd ${targetDir}`);
        console.log("  python main.py       # smoke-test: pipe a handcrafted init message");
        console.log("");
        console.log("See README.md for how to register this extension in .kota/config.json");
      } else {
        generateExtensionScaffold(name, safeName, targetDir);
        console.log(`Extension scaffold created at: ${targetDir}`);
        console.log("");
        console.log("Next steps:");
        console.log(`  cd ${targetDir}`);
        console.log("  npm install          # install devDependencies");
        console.log("  npm run typecheck    # verify types");
        console.log("  npm run build        # compile to dist/");
        console.log("");
        console.log(`To use without building, copy dist/index.js to .kota/extensions/${safeName}/index.js`);
      }
    });

  return extCmd;
}

function printSection(label: string, items: string[]): void {
  if (items.length === 0) return;
  console.log(`\n${label} (${items.length}):`);
  for (const item of items) console.log(`  • ${item}`);
}

const extensionManagerModule: KotaExtension = {
  name: "extension-manager",
  version: "1.0.0",
  description: "Inspect and scaffold KOTA extensions",

  commands: (ctx: ExtensionContext) => [buildExtensionCommand(ctx)],
};

export default extensionManagerModule;
