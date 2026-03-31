import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import type { KotaConfig } from "./config.js";
import { loadConfig, updateProjectConfig } from "./config.js";

const KNOWN_CONFIG_KEYS: ReadonlySet<string> = new Set<keyof KotaConfig>([
  "model",
  "editorModel",
  "maxTokens",
  "architect",
  "thinking",
  "thinkingBudget",
  "verbose",
  "skipConfirmations",
  "autoEnable",
  "user",
  "aliases",
  "reflection",
  "guardrails",
  "extensions",
  "foreignExtensions",
  "providers",
  "modelProvider",
  "modelTiers",
  "agentModels",
  "webhooks",
  "approvalTtlMs",
  "dailyBudgetUsd",
  "runsGc",
  "serve",
  "daemon",
]);

function readRawKeys(path: string): string[] | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    return Object.keys(raw);
  } catch {
    return null;
  }
}

export function registerConfigCommands(program: Command): void {
  const config = program
    .command("config")
    .description("Inspect and validate KOTA configuration");

  config
    .command("validate")
    .description("Validate and print the resolved merged config")
    .option("--json", "Output only the resolved config as JSON")
    .action((opts: { json?: boolean }) => {
      const projectDir = process.cwd();
      const globalPath = join(homedir(), ".kota", "config.json");
      const projectPath = join(projectDir, ".kota", "config.json");

      const resolved = loadConfig(projectDir);

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(resolved, null, 2)}\n`);
        return;
      }

      const sources: Array<[string, string]> = [];
      if (existsSync(globalPath)) sources.push(["global", globalPath]);
      if (existsSync(projectPath)) sources.push(["project", projectPath]);

      if (sources.length === 0) {
        console.log("Config sources: (none found — using defaults)");
      } else {
        console.log("Config sources:");
        for (const [label, path] of sources) {
          console.log(`  ${label.padEnd(7)} ${path}`);
        }
      }
      console.log();

      const warnings: string[] = [];
      for (const [label, path] of sources) {
        const keys = readRawKeys(path);
        if (!keys) continue;
        for (const k of keys) {
          if (!KNOWN_CONFIG_KEYS.has(k)) {
            warnings.push(`Unknown key "${k}" in ${label} config (${path})`);
          }
        }
      }

      if (warnings.length > 0) {
        for (const w of warnings) {
          console.error(`Warning: ${w}`);
        }
        console.log();
      }

      console.log("Resolved config:");
      console.log(JSON.stringify(resolved, null, 2));
    });

  config
    .command("get <key>")
    .description("Print the value of a config key from the resolved merged config")
    .action((key: string) => {
      const projectDir = process.cwd();
      const resolved = loadConfig(projectDir);
      const parts = key.split(".");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let current: any = resolved;
      for (const part of parts) {
        if (current === null || typeof current !== "object" || !(part in current)) {
          console.error(`Error: key "${key}" not found in resolved config`);
          process.exit(1);
        }
        current = current[part];
      }
      if (typeof current === "string") {
        process.stdout.write(`${current}\n`);
      } else {
        process.stdout.write(`${JSON.stringify(current, null, 2)}\n`);
      }
    });

  config
    .command("set <key> <value>")
    .description("Set a config key in the project-level .kota/config.json")
    .action((key: string, value: string) => {
      const projectDir = process.cwd();
      const topKey = key.split(".")[0];
      if (!KNOWN_CONFIG_KEYS.has(topKey)) {
        console.error(`Warning: "${topKey}" is not a recognised config key`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        parsed = value;
      }
      const parts = key.split(".");
      updateProjectConfig(projectDir, (raw) => {
        if (parts.length === 1) {
          return { ...raw, [parts[0]]: parsed };
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const nested: any = { ...(typeof (raw as any)[parts[0]] === "object" && (raw as any)[parts[0]] !== null ? (raw as any)[parts[0]] : {}) };
        nested[parts[1]] = parsed;
        return { ...raw, [parts[0]]: nested };
      });
    });
}
