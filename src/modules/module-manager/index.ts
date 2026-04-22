import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { resolveProjectDir } from "#core/config/project-dir.js";
import type { DaemonControlAddress } from "#core/daemon/daemon-control.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { DaemonControlClient } from "#core/server/daemon-client.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { isProcessAlive } from "#core/util/process-alive.js";
import {
  blank,
  kvBlock,
  type LineNode,
  line,
  plain,
  type RenderNode,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import { handleListModules } from "./routes.js";
import { generateModuleScaffold, generatePythonScaffold } from "./scaffolds.js";

function healthRole(status: string): "success" | "warn" | "error" | "muted" {
  switch (status) {
    case "healthy":
      return "success";
    case "degraded":
      return "warn";
    case "failed":
      return "error";
    default:
      return "muted";
  }
}

function buildSection(label: string, items: string[]): RenderNode | null {
  if (items.length === 0) return null;
  const header = line(
    plain(""),
    span(`${label} (${items.length}):`, "info", true),
  );
  const rows: LineNode[] = items.map((item) => line(
    plain("  "),
    span("•", "muted"),
    plain(` ${item}`),
  ));
  return stack(blank(), header, ...rows);
}

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
        print(line(plain("No modules loaded.")));
        return;
      }
      const nameWidth = Math.max(...summaries.map((s) => s.name.length), 4);
      const headerLabel =
        `${"Name".padEnd(nameWidth)}  ${"Ver".padEnd(7)}  ${"Tools".padStart(5)}  ${"Wf".padStart(3)}  ${"Cmd".padStart(3)}  ${"Ch".padStart(3)}  ${"Sk".padStart(3)}  ${"Ag".padStart(3)}  Description`;
      const header = line(span(headerLabel, "muted", true));
      const rule = line(span("-".repeat(headerLabel.length + 8), "muted"));
      const rows: LineNode[] = summaries.map((s) => {
        const ver = (s.version ?? "").padEnd(7);
        const tools = String(s.toolNames.length).padStart(5);
        const wf = String(s.workflowNames.length).padStart(3);
        const cmd = String(s.commandNames.length).padStart(3);
        const ch = String(s.channelNames.length).padStart(3);
        const sk = String(s.skillNames.length).padStart(3);
        const ag = String(s.agentNames.length).padStart(3);
        const desc = s.description ?? "";
        return line(
          span(s.name.padEnd(nameWidth), "accent"),
          plain(`  ${ver}  ${tools}  ${wf}  ${cmd}  ${ch}  ${sk}  ${ag}  `),
          span(desc, "muted"),
        );
      });
      print(stack(
        header,
        rule,
        ...rows,
        blank(),
        line(
          span(String(summaries.length), "accent"),
          plain(" module(s) loaded."),
        ),
      ));
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
      const entries: Array<{ label: string; value: string; role?: "accent" | "info" | "muted" | "success" | "warn" | "error" }> = [
        { label: "Module", value: moduleSummary.name, role: "accent" },
      ];
      if (moduleSummary.version) entries.push({ label: "Version", value: moduleSummary.version, role: "muted" });
      if (moduleSummary.description) entries.push({ label: "Description", value: moduleSummary.description });
      if (moduleSummary.dependencies.length > 0) {
        entries.push({ label: "Depends on", value: moduleSummary.dependencies.join(", "), role: "muted" });
      }
      if (moduleSummary.health) {
        const h = moduleSummary.health;
        const restartPart = h.restartCount === 0
          ? `(${h.restartCount} restarts)`
          : `(${h.restartCount} restarts, last: ${h.lastRestartAt ?? "unknown"})`;
        entries.push({ label: "Health", value: `${h.status}  ${restartPart}`, role: healthRole(h.status) });
      }
      if (moduleSummary.commandError) {
        entries.push({ label: "Command summary error", value: moduleSummary.commandError, role: "error" });
      }
      if (moduleSummary.routeError) {
        entries.push({ label: "Route summary error", value: moduleSummary.routeError, role: "error" });
      }
      const sections: RenderNode[] = [];
      for (const [label, items] of [
        ["Tools", moduleSummary.toolNames],
        ["Workflows", moduleSummary.workflowNames],
        ["Commands", moduleSummary.commandNames],
        ["Routes", moduleSummary.routeSummaries],
        ["Channels", moduleSummary.channelNames],
        ["Skills", moduleSummary.skillNames],
        ["Agents", moduleSummary.agentNames],
      ] as const) {
        const section = buildSection(label, items);
        if (section) sections.push(section);
      }
      print(stack(kvBlock(entries), ...sections));
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
        print(stack(
          line(
            span("Python module scaffold created at: ", "success"),
            span(targetDir, "accent"),
          ),
          blank(),
          line(span("Next steps:", "info", true)),
          line(plain(`  cd ${targetDir}`)),
          line(span("  python main.py       ", "muted"), plain("# smoke-test: pipe a handcrafted init message")),
          blank(),
          line(span("See README.md for how to register this module in .kota/config.json", "muted")),
        ));
      } else {
        generateModuleScaffold(name, safeName, targetDir);
        print(stack(
          line(
            span("Module scaffold created at: ", "success"),
            span(targetDir, "accent"),
          ),
          blank(),
          line(span("Next steps:", "info", true)),
          line(plain(`  cd ${targetDir}`)),
          line(span("  pnpm install         ", "muted"), plain("# install devDependencies")),
          line(span("  pnpm run typecheck   ", "muted"), plain("# verify types")),
          line(span("  pnpm build           ", "muted"), plain("# compile to dist/")),
          blank(),
          line(span(
            `To use without building, copy dist/index.js to .kota/modules/${safeName}/index.js`,
            "muted",
          )),
        ));
      }
    });

  moduleCommand
    .command("reload <name>")
    .description("Reload a module from disk via daemon config reload")
    .action(async (name: string) => {
      const summaries = ctx.getModuleSummaries();
      const exists = summaries.some((s) => s.name === name);
      if (!exists) {
        const names = summaries.map((s) => s.name).join(", ");
        console.error(`Module "${name}" not found. Loaded: ${names || "(none)"}`);
        process.exit(1);
      }

      const address = readOptionalJsonFile<DaemonControlAddress>(
        join(resolveProjectDir(), ".kota", "daemon-control.json"),
      );
      if (!address || typeof address.pid !== "number" || !isProcessAlive(address.pid)) {
        console.error("Daemon is not running. Module reload requires a running daemon.");
        process.exit(1);
      }

      const client = DaemonControlClient.fromStateDir();
      if (!client) {
        console.error("Cannot connect to daemon.");
        process.exit(1);
      }

      const result = await client.reloadConfig();
      if (!result) {
        console.error("Daemon reload failed or daemon is not reachable.");
        process.exit(1);
      }

      const reloaded = result.changedModules.includes(name);
      if (reloaded) {
        print(line(
          plain("Module "),
          span(`"${name}"`, "accent"),
          span(" reloaded from disk.", "success"),
        ));
      } else {
        print(line(
          plain("Module "),
          span(`"${name}"`, "accent"),
          span(" unchanged ", "muted"),
          plain(`(no config diff detected). ${result.workflows} workflow(s) active.`),
        ));
      }
    });

  return moduleCommand;
}

const moduleManagerModule: KotaModule = {
  name: "module-manager",
  version: "1.0.0",
  description: "Inspect and scaffold KOTA modules",
  dependencies: ["rendering"],

  commands: (ctx: ModuleContext) => [buildModuleCommand(ctx)],

  routes: (ctx) => [
    { method: "GET", path: "/api/modules", handler: (_req, res) => handleListModules(res, ctx.getModuleSummaries()) },
  ],
};

export default moduleManagerModule;
