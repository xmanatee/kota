import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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

  extCmd
    .command("new <name>")
    .description("Scaffold a new extension starter in a new directory")
    .option("--dir <path>", "Target directory (default: ./<name>)")
    .action((name: string, opts: { dir?: string }) => {
      const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      const targetDir = resolve(opts.dir ?? safeName);

      if (existsSync(targetDir)) {
        console.error(`Error: directory already exists: ${targetDir}`);
        process.exit(1);
      }

      generateExtensionScaffold(name, safeName, targetDir);

      console.log(`Extension scaffold created at: ${targetDir}`);
      console.log("");
      console.log("Next steps:");
      console.log(`  cd ${targetDir}`);
      console.log("  npm install          # install devDependencies");
      console.log("  npm run typecheck    # verify types");
      console.log("  npm run build        # compile to dist/");
      console.log("");
      console.log("To use without building, copy dist/index.js to .kota/plugins/");
    });
}

function generateExtensionScaffold(name: string, safeName: string, dir: string): void {
  const srcDir = join(dir, "src");
  mkdirSync(srcDir, { recursive: true });

  writeFileSync(join(dir, "package.json"), packageJson(safeName));
  writeFileSync(join(dir, "tsconfig.json"), tsconfig());
  writeFileSync(join(srcDir, "index.ts"), indexTs(name, safeName));
  writeFileSync(join(dir, "AGENTS.md"), agentsMd(name));
}

function packageJson(safeName: string): string {
  return `${JSON.stringify(
    {
      name: safeName,
      version: "0.1.0",
      description: "",
      type: "module",
      main: "dist/index.js",
      exports: { ".": "./dist/index.js" },
      scripts: {
        build: "tsc",
        typecheck: "tsc --noEmit",
      },
      peerDependencies: {
        kota: "*",
      },
      devDependencies: {
        kota: "*",
        typescript: "^5.7.0",
      },
    },
    null,
    2,
  )}\n`;
}

function tsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        outDir: "dist",
        declaration: true,
        strict: true,
        skipLibCheck: true,
      },
      include: ["src"],
    },
    null,
    2,
  )}\n`;
}

function indexTs(name: string, safeName: string): string {
  const toolName = `${safeName.replace(/-/g, "_")}_hello`;
  return `import type { KotaExtension, ToolDef } from "kota/extension";

// KotaExtension supports: tools, commands, routes, workflows, channels,
// skills, agents, onLoad, onUnload. Add fields as your extension grows.

const helloTool: ToolDef = {
  tool: {
    name: "${toolName}",
    description: "A stub tool — replace with real logic.",
    input_schema: {
      type: "object" as const,
      properties: {
        message: { type: "string", description: "Message to echo" },
      },
      required: ["message"],
    },
  },
  runner: async (input) => {
    const { message } = input as { message: string };
    return { content: \`${name}: \${message}\` };
  },
};

const extension: KotaExtension = {
  name: "${safeName}",
  version: "0.1.0",
  description: "${name} extension",
  tools: [helloTool],
  // onLoad: (ctx) => { /* initialize — ctx.log, ctx.storage, ctx.config */ },
  // onUnload: () => { /* clean up connections, timers */ },
};

export default extension;
`;
}

function agentsMd(name: string): string {
  return `# ${name} Extension

This directory contains the \`${name}\` KOTA extension.

## Purpose

<!-- Describe what this extension does and why it exists. -->

## Boundaries

- Contribute tools, commands, routes, workflows, channels, skills, or agents
  via the \`KotaExtension\` export in \`src/index.ts\`.
- Do not import KOTA internals directly; use the \`ExtensionContext\` API
  passed to \`onLoad\` for runtime services (storage, logging, config).

## Development

\`\`\`sh
npm install          # install devDependencies (including kota for types)
npm run typecheck    # verify types against KotaExtension
npm run build        # compile to dist/ for npm-based use
\`\`\`

For local drop-in use without npm, compile and copy \`dist/index.js\` to
\`.kota/plugins/${name}.js\` in your KOTA project.
`;
}

function printSection(label: string, items: string[]): void {
  if (items.length === 0) return;
  console.log(`\n${label} (${items.length}):`);
  for (const item of items) console.log(`  • ${item}`);
}
