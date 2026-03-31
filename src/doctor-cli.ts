import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "./config.js";
import { discoverExtensions } from "./extension-discovery.js";
import { ExtensionLoader } from "./extension-loader.js";
import { builtinExtensions } from "./extensions/index.js";
import { DaemonControlClient } from "./server/daemon-client.js";
import { getBuiltinWorkflowDefinitions } from "./workflow/registry.js";
import { validateWorkflowDefinitions, WorkflowDefinitionError } from "./workflow/validation.js";

type CheckStatus = "pass" | "warn" | "fail";

export type CheckResult = {
  label: string;
  status: CheckStatus;
  detail?: string;
};

function pass(label: string, detail?: string): CheckResult {
  return { label, status: "pass", detail };
}

function warn(label: string, detail?: string): CheckResult {
  return { label, status: "warn", detail };
}

function fail(label: string, detail?: string): CheckResult {
  return { label, status: "fail", detail };
}

function checkDisk(projectDir: string): CheckResult[] {
  const results: CheckResult[] = [];
  const kotaDir = join(projectDir, ".kota");

  if (!existsSync(kotaDir)) {
    results.push(fail("Disk: .kota/ directory", "Missing — run `kota` once to initialize"));
    return results;
  }
  results.push(pass("Disk: .kota/ directory", "Present"));

  const tmpFile = join(kotaDir, `.doctor-write-test-${Date.now()}`);
  try {
    writeFileSync(tmpFile, "");
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
    results.push(pass("Disk: .kota/ writable"));
  } catch {
    results.push(fail("Disk: .kota/ writable", "Directory is not writable"));
  }

  return results;
}

function checkConfigFile(configPath: string, label: string): CheckResult {
  if (!existsSync(configPath)) {
    return warn(label, "Not present (using defaults)");
  }
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return fail(label, "Parses as JSON but is not an object");
    }
    return pass(label, "Valid JSON object");
  } catch (err) {
    return fail(label, `JSON parse error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function checkWorkflowDefinitions(projectDir: string): CheckResult {
  try {
    const defs = getBuiltinWorkflowDefinitions();
    const validated = validateWorkflowDefinitions(defs, projectDir);
    return pass("Workflows: built-in definitions", `${validated.length} valid`);
  } catch (err) {
    if (err instanceof WorkflowDefinitionError) {
      return fail("Workflows: built-in definitions", err.message);
    }
    return fail("Workflows: built-in definitions", String(err));
  }
}

async function checkExtensions(projectDir: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  try {
    const config = loadConfig(projectDir);
    const loader = new ExtensionLoader(config, false, { commandsOnly: true });
    loader.setCwd(projectDir);
    const discovered = await discoverExtensions(undefined, false);
    await loader.loadAll([...builtinExtensions, ...discovered]);
    const summaries = loader.getExtensionSummaries();
    results.push(pass("Extensions: loaded", `${summaries.length} extension(s)`));
  } catch (err) {
    results.push(fail("Extensions: loaded", `Load error: ${err instanceof Error ? err.message : String(err)}`));
  }
  return results;
}

function checkProvidersConfig(projectDir: string): CheckResult[] {
  const config = loadConfig(projectDir);
  const providers = config.providers ?? {};
  const names = Object.entries(providers);
  if (names.length === 0) {
    return [pass("Providers: configuration", "Using defaults")];
  }
  return [pass("Providers: configuration", names.map(([t, n]) => `${t}=${n}`).join(", "))];
}

export async function runDoctorChecks(projectDir: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Daemon check
  const client = DaemonControlClient.fromStateDir(join(projectDir, ".kota"));
  const status = client ? await client.getDaemonStatus() : null;

  if (!client) {
    results.push(warn("Daemon", "No daemon-control.json found — daemon is not running"));
  } else if (!status) {
    results.push(fail("Daemon", "Daemon control file present but API is unreachable"));
  } else {
    results.push(pass("Daemon", `Running (pid ${status.pid ?? "?"}, started ${status.startedAt ?? "?"})`));
  }

  // Config checks
  const globalConfigPath = join(homedir(), ".kota", "config.json");
  const projectConfigPath = join(projectDir, ".kota", "config.json");
  results.push(checkConfigFile(globalConfigPath, "Config: global (~/.kota/config.json)"));
  results.push(checkConfigFile(projectConfigPath, "Config: project (.kota/config.json)"));

  // Extension checks (skip if daemon running to avoid double-load issues)
  if (status) {
    results.push(pass("Extensions", "Managed by daemon (use `kota extension list` for details)"));
  } else {
    const extResults = await checkExtensions(projectDir);
    results.push(...extResults);
  }

  // Provider checks
  results.push(...checkProvidersConfig(projectDir));

  // Workflow checks (offline or online)
  if (status) {
    const defResult = await client!.getWorkflowDefinitions();
    if (!defResult) {
      results.push(warn("Workflows", "Could not fetch definitions from daemon"));
    } else {
      const count = defResult.definitions.length;
      results.push(pass("Workflows", `${count} definition(s) loaded by daemon`));
    }
  } else {
    results.push(checkWorkflowDefinitions(projectDir));
  }

  // Disk checks
  results.push(...checkDisk(projectDir));

  return results;
}

function statusIcon(status: CheckStatus): string {
  if (status === "pass") return "✓";
  if (status === "warn") return "!";
  return "✗";
}

function printResults(results: CheckResult[]): void {
  const labelWidth = Math.max(...results.map((r) => r.label.length), 10);
  for (const r of results) {
    const icon = statusIcon(r.status);
    const label = r.label.padEnd(labelWidth);
    const detail = r.detail ? `  ${r.detail}` : "";
    console.log(`  [${icon}] ${label}${detail}`);
  }
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Run runtime health checks and print a pass/warn/fail summary")
    .option("--json", "Output results as JSON")
    .action(async (opts: { json?: boolean }) => {
      const projectDir = process.cwd();
      const results = await runDoctorChecks(projectDir);

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        console.log("\nKOTA Health Check\n");
        printResults(results);
        const failCount = results.filter((r) => r.status === "fail").length;
        const warnCount = results.filter((r) => r.status === "warn").length;
        console.log(
          `\n${results.length} check(s): ${results.length - failCount - warnCount} passed, ${warnCount} warned, ${failCount} failed`,
        );
      }

      const anyFail = results.some((r) => r.status === "fail");
      if (anyFail) process.exit(1);
    });
}
