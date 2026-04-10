import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { handleListModules } from "./routes.js";
import { generateModuleScaffold, generatePythonScaffold } from "./scaffolds.js";

function buildModuleCommand(ctx: ModuleContext): Command {
  const moduleCommand = new Command("module")
    .description("Inspect loaded modules and their contributions");

  moduleCommand
    .command("list")
    .description("List all loaded modules with contribution counts")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      const summaries = ctx.getModuleSummaries();
      if (opts.json) {
        console.log(JSON.stringify(summaries, null, 2));
        return;
      }
      if (summaries.length === 0) {
        console.log("No modules loaded.");
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
      console.log(`\n${summaries.length} module(s) loaded.`);
    });

  moduleCommand
    .command("inspect <name>")
    .description("Show full detail for one module")
    .option("--json", "Output as JSON")
    .action((name: string, opts: { json?: boolean }) => {
      const summaries = ctx.getModuleSummaries();
      const moduleSummary = summaries.find((s) => s.name === name);
      if (!moduleSummary) {
        const names = summaries.map((s) => s.name).join(", ");
        console.error(`Module "${name}" not found. Loaded: ${names || "(none)"}`);
        process.exit(1);
      }
      if (opts.json) {
        console.log(JSON.stringify(moduleSummary, null, 2));
        return;
      }
      console.log(`Module: ${moduleSummary.name}`);
      if (moduleSummary.version) console.log(`Version:   ${moduleSummary.version}`);
      if (moduleSummary.description) console.log(`Description: ${moduleSummary.description}`);
      if (moduleSummary.dependencies.length > 0) {
        console.log(`Depends on: ${moduleSummary.dependencies.join(", ")}`);
      }
      if (moduleSummary.health) {
        const h = moduleSummary.health;
        const restartPart = h.restartCount === 0 ? `(${h.restartCount} restarts)` : `(${h.restartCount} restarts, last: ${h.lastRestartAt ?? "unknown"})`;
        console.log(`Health:    ${h.status}  ${restartPart}`);
      }
      if (moduleSummary.commandError) {
        console.log(`Command summary error: ${moduleSummary.commandError}`);
      }
      if (moduleSummary.routeError) {
        console.log(`Route summary error: ${moduleSummary.routeError}`);
      }
      printSection("Tools", moduleSummary.toolNames);
      printSection("Workflows", moduleSummary.workflowNames);
      printSection("Commands", moduleSummary.commandNames);
      printSection("Routes", moduleSummary.routeSummaries);
      printSection("Channels", moduleSummary.channelNames);
      printSection("Skills", moduleSummary.skillNames);
      printSection("Agents", moduleSummary.agentNames);
    });

  moduleCommand
    .command("new <name>")
    .description("Scaffold a new module starter in a new directory")
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
        console.log(`Python module scaffold created at: ${targetDir}`);
        console.log("");
        console.log("Next steps:");
        console.log(`  cd ${targetDir}`);
        console.log("  python main.py       # smoke-test: pipe a handcrafted init message");
        console.log("");
        console.log("See README.md for how to register this module in .kota/config.json");
      } else {
        generateModuleScaffold(name, safeName, targetDir);
        console.log(`Module scaffold created at: ${targetDir}`);
        console.log("");
        console.log("Next steps:");
        console.log(`  cd ${targetDir}`);
        console.log("  pnpm install         # install devDependencies");
        console.log("  pnpm run typecheck   # verify types");
        console.log("  pnpm build           # compile to dist/");
        console.log("");
        console.log(`To use without building, copy dist/index.js to .kota/modules/${safeName}/index.js`);
      }
    });

  return moduleCommand;
}

function printSection(label: string, items: string[]): void {
  if (items.length === 0) return;
  console.log(`\n${label} (${items.length}):`);
  for (const item of items) console.log(`  • ${item}`);
}

const moduleManagerModule: KotaModule = {
  name: "module-manager",
  version: "1.0.0",
  description: "Inspect and scaffold KOTA modules",

  commands: (ctx: ModuleContext) => [buildModuleCommand(ctx)],

  routes: (ctx) => [
    { method: "GET", path: "/api/modules", handler: (_req, res) => handleListModules(res, ctx.getModuleSummaries()) },
  ],
};

export default moduleManagerModule;
