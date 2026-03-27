/**
 * Registry module — install, remove, update, and list external tool packages.
 *
 * Extracts the `tools` CLI command from cli.ts into a KotaExtension,
 * continuing the modular architecture plan. The actual registry logic
 * lives in src/registry.ts; this module wires it into the CLI as `kota tools`.
 */

import { Command } from "commander";
import type { KotaExtension } from "../extension-types.js";
import { installTool, listTools, removeTool, updateTool } from "../registry.js";

const registryModule: KotaExtension = {
  name: "registry",
  version: "1.0.0",
  description: "Install, remove, update, and list external tool packages",

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
          console.error(`[kota] Installing from ${source}...`);
          const result = await installTool(source);
          console.log(
            `Installed "${result.name}" (${result.source}) — ${result.files.length} file(s)`,
          );
        } catch (err) {
          console.error(`Error: ${(err as Error).message}`);
          process.exit(1);
        }
      });

    toolsCmd
      .command("list")
      .description("List installed tools")
      .action(() => {
        const tools = listTools();
        if (tools.length === 0) {
          console.log(
            "No tools installed. Use `kota tools install <source>` to add one.",
          );
          return;
        }

        console.log(
          `${"Name".padEnd(20)} ${"Source".padEnd(8)} ${"Version".padEnd(12)} URI`,
        );
        console.log("-".repeat(72));
        for (const t of tools) {
          console.log(
            `${t.name.padEnd(20)} ${t.source.padEnd(8)} ${t.version.padEnd(12)} ${t.uri}`,
          );
        }
      });

    toolsCmd
      .command("remove <name>")
      .description("Remove an installed tool")
      .action((name: string) => {
        if (removeTool(name)) {
          console.log(`Removed "${name}".`);
        } else {
          console.error(`Tool "${name}" is not installed.`);
          process.exit(1);
        }
      });

    toolsCmd
      .command("update <name>")
      .description("Update an installed tool to the latest version")
      .action(async (name: string) => {
        try {
          console.error(`[kota] Updating "${name}"...`);
          const result = await updateTool(name);
          console.log(`Updated "${result.name}" (${result.source})`);
        } catch (err) {
          console.error(`Error: ${(err as Error).message}`);
          process.exit(1);
        }
      });

    return [toolsCmd];
  },
};

export default registryModule;
