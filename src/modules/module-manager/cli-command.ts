import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
  blank,
  type ColumnsNode,
  columns,
  kvBlock,
  type LineNode,
  line,
  plain,
  type RenderNode,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import { print, printToStderr, writeJson } from "#modules/rendering/transport.js";
import type { ModuleInspectEntry, ModuleListEntry } from "./client.js";
import { generateModuleScaffold, generatePythonScaffold } from "./scaffolds.js";

function healthRole(status: string): "success" | "warn" | "error" | "muted" {
  switch (status) {
    case "healthy": return "success";
    case "degraded": return "warn";
    case "failed": return "error";
    default: return "muted";
  }
}

export function buildModuleListNode(modules: ModuleListEntry[]): ColumnsNode {
  return columns(
    [
      { header: "Name", role: "accent" },
      { header: "Ver", role: "muted", minWidth: 3 },
      { header: "Tools", align: "right", minWidth: 5 },
      { header: "Wf", align: "right", minWidth: 2 },
      { header: "Cmd", align: "right", minWidth: 3 },
      { header: "Ch", align: "right", minWidth: 2 },
      { header: "Sk", align: "right", minWidth: 2 },
      { header: "Ag", align: "right", minWidth: 2 },
      { header: "Description", role: "muted", maxWidth: 60 },
    ],
    modules.map((summary) => ({
      cells: [
        { spans: [{ text: summary.name, role: "accent" }] },
        { spans: [{ text: summary.version ?? "", role: "muted" }] },
        { spans: [{ text: String(summary.toolCount) }] },
        { spans: [{ text: String(summary.workflowCount) }] },
        { spans: [{ text: String(summary.commandCount) }] },
        { spans: [{ text: String(summary.channelCount) }] },
        { spans: [{ text: String(summary.skillCount) }] },
        { spans: [{ text: String(summary.agentCount) }] },
        { spans: [{ text: summary.description ?? "", role: "muted" }] },
      ],
    })),
  );
}

function buildSection(label: string, items: string[]): RenderNode | null {
  if (items.length === 0) return null;
  const header = line(plain(""), span(`${label} (${items.length}):`, "info", true));
  const rows: LineNode[] = items.map((item) => line(
    plain("  "),
    span("•", "muted"),
    plain(` ${item}`),
  ));
  return stack(blank(), header, ...rows);
}

function manifestCapabilityRows(summary: ModuleInspectEntry): string[] {
  return summary.manifest?.capabilities.map((capability) =>
    `${capability.id} (${capability.scope})`
  ) ?? [];
}

function manifestEffectRows(summary: ModuleInspectEntry): string[] {
  return summary.manifest?.effects.map((effect) =>
    `${effect.id}: ${effect.effect.kind}/${effect.effect.scope} (${effect.risk})`
  ) ?? [];
}

export function buildModuleCommand(ctx: ModuleContext): Command {
  const moduleCommand = new Command("module")
    .description("Inspect loaded modules and their contributions");

  moduleCommand.command("list")
    .description("List all loaded modules with contribution counts")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const result = await ctx.client.modules.list();
      if (opts.json) {
        writeJson(result.modules, { pretty: true });
        return;
      }
      if (result.modules.length === 0) {
        print(line(plain("No modules loaded.")));
        return;
      }
      print(stack(
        buildModuleListNode(result.modules),
        blank(),
        line(span(String(result.modules.length), "accent"), plain(" module(s) loaded.")),
      ));
    });

  moduleCommand.command("inspect <name>")
    .description("Show full detail for one module")
    .option("--json", "Output as JSON")
    .action(async (name: string, opts: { json?: boolean }) => {
      const result = await ctx.client.modulesAdmin.inspect(name);
      if (!result.found) {
        const list = await ctx.client.modules.list();
        const names = list.modules.map((summary) => summary.name).join(", ");
        printToStderr(line(span(`Module "${name}" not found. Loaded: ${names || "(none)"}`, "error")));
        process.exit(1);
      }
      const summary = result.module;
      if (opts.json) {
        writeJson(summary, { pretty: true });
        return;
      }
      const entries: Array<{ label: string; value: string; role?: "accent" | "info" | "muted" | "success" | "warn" | "error" }> = [
        { label: "Module", value: summary.name, role: "accent" },
      ];
      if (summary.version) entries.push({ label: "Version", value: summary.version, role: "muted" });
      if (summary.description) entries.push({ label: "Description", value: summary.description });
      if (summary.dependencies.length > 0) {
        entries.push({ label: "Depends on", value: summary.dependencies.join(", "), role: "muted" });
      }
      if (summary.health) {
        const health = summary.health;
        const restartPart = health.restartCount === 0
          ? `(${health.restartCount} restarts)`
          : `(${health.restartCount} restarts, last: ${health.lastRestartAt ?? "unknown"})`;
        entries.push({
          label: "Health",
          value: `${health.status}  ${restartPart}`,
          role: healthRole(health.status),
        });
      }
      if (summary.commandError) {
        entries.push({ label: "Command summary error", value: summary.commandError, role: "error" });
      }
      if (summary.routeError) {
        entries.push({ label: "Route summary error", value: summary.routeError, role: "error" });
      }
      const sections: RenderNode[] = [];
      for (const [label, items] of [
        ["Tools", summary.toolNames],
        ["Workflows", summary.workflowNames],
        ["Commands", summary.commandNames],
        ["Routes", summary.routeSummaries],
        ["Channels", summary.channelNames],
        ["Skills", summary.skillNames],
        ["Agents", summary.agentNames],
        ["Capabilities", manifestCapabilityRows(summary)],
        ["Effects", manifestEffectRows(summary)],
      ] as const) {
        const section = buildSection(label, items);
        if (section) sections.push(section);
      }
      print(stack(kvBlock(entries), ...sections));
    });

  moduleCommand.command("new <name>")
    .description("Scaffold a new module starter in a new directory")
    .option("--dir <path>", "Target directory (default: ./<name>)")
    .option("--language <lang>", "Scaffold language: typescript (default) or python")
    .action((name: string, opts: { dir?: string; language?: string }) => {
      const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      const targetDir = resolve(opts.dir ?? safeName);
      const language = opts.language ?? "typescript";
      if (language !== "typescript" && language !== "python") {
        printToStderr(line(span(`Error: unsupported language: ${language}. Supported: typescript, python`, "error")));
        process.exit(1);
      }
      if (existsSync(targetDir)) {
        printToStderr(line(span(`Error: directory already exists: ${targetDir}`, "error")));
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
          line(
            span("  python main.py       ", "muted"),
            plain("# smoke-test: pipe a handcrafted init message"),
          ),
          blank(),
          line(span(
            "See README.md for how to register this module in .kota/config.json",
            "muted",
          )),
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

  moduleCommand.command("reload <name>")
    .description("Reload a module from disk via daemon config reload")
    .action(async (name: string) => {
      const result = await ctx.client.modulesAdmin.reload(name);
      if (!result.ok) {
        if (result.reason === "daemon_required") {
          printToStderr(line(span(
            "Daemon is not running. Module reload requires a running daemon.",
            "error",
          )));
        } else {
          const list = await ctx.client.modules.list();
          const names = list.modules.map((summary) => summary.name).join(", ");
          printToStderr(line(span(
            `Module "${name}" not found. Loaded: ${names || "(none)"}`,
            "error",
          )));
        }
        process.exit(1);
      }
      if (result.reloaded) {
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
          plain(`(no config diff detected). ${result.workflowsActive} workflow(s) active.`),
        ));
      }
    });

  return moduleCommand;
}
