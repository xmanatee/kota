/**
 * Registry module — install, remove, update, and list external tool
 * packages.
 *
 * Extracts the `tools` CLI command from cli.ts into a KotaModule,
 * continuing the module-first architecture plan. The actual registry logic
 * lives in src/core/modules/registry.ts; this module wires it into the CLI as
 * `kota tools`.
 */

import { Command } from "commander";
import type { KotaModule } from "#core/modules/module-types.js";
import { installTool, listTools, removeTool, updateTool } from "#core/modules/registry.js";
import { columns, line, plain, span } from "#modules/rendering/primitives.js";
import { print, printToStderr } from "#modules/rendering/transport.js";

function printRegistryError(message: string): void {
  printToStderr(line(span(message, "error")));
}

const registryModule: KotaModule = {
  name: "registry",
  version: "1.0.0",
  description: "Install, remove, update, and list external tool packages",
  dependencies: ["rendering"],

  commands: () => {
    const toolsCmd = new Command("tools").description(
      "Manage installed tool packages",
    );

    toolsCmd
      .command("install <source>")
      .description(
        "Install a tool from npm, URL, or GitHub (e.g., kota-weather, https://...tool.mjs, user/repo)",
      )
      .action(async (source: string) => {
        try {
          printToStderr(line(span(`[kota] Installing from ${source}...`, "muted")));
          const result = await installTool(source);
          print(line(
            span(`Installed "${result.name}"`, "success"),
            plain(` (${result.source}) — ${result.files.length} file(s)`),
          ));
        } catch (err) {
          printRegistryError(`Error: ${(err as Error).message}`);
          process.exit(1);
        }
      });

    toolsCmd
      .command("list")
      .description("List installed tools")
      .action(() => {
        const tools = listTools();
        if (tools.length === 0) {
          print(line(plain("No tools installed. Use `kota tools install <source>` to add one.")));
          return;
        }

        print(columns(
          [
            { header: "Name", role: "accent", maxWidth: 30 },
            { header: "Source", minWidth: 8 },
            { header: "Version", minWidth: 8, maxWidth: 16 },
            { header: "URI", role: "muted", maxWidth: 80 },
          ],
          tools.map((t) => ({
            cells: [
              { spans: [{ text: t.name, role: "accent" }] },
              { spans: [{ text: t.source }] },
              { spans: [{ text: t.version }] },
              { spans: [{ text: t.uri, role: "muted" }] },
            ],
          })),
        ));
      });

    toolsCmd
      .command("remove <name>")
      .description("Remove an installed tool")
      .action((name: string) => {
        if (removeTool(name)) {
          print(line(span(`Removed "${name}".`, "success")));
        } else {
          printRegistryError(`Tool "${name}" is not installed.`);
          process.exit(1);
        }
      });

    toolsCmd
      .command("update <name>")
      .description("Update an installed tool to the latest version")
      .action(async (name: string) => {
        try {
          printToStderr(line(span(`[kota] Updating "${name}"...`, "muted")));
          const result = await updateTool(name);
          print(line(span(`Updated "${result.name}" (${result.source})`, "success")));
        } catch (err) {
          printRegistryError(`Error: ${(err as Error).message}`);
          process.exit(1);
        }
      });

    return [toolsCmd];
  },
};

export default registryModule;
