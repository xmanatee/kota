/**
 * Doctor module — owns the `kota doctor` CLI health check surface.
 *
 * Registers the `kota doctor` command that runs pass/warn/fail checks
 * against daemon connectivity, config validity, modules, providers,
 * workflow definitions, and disk state.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { Command } from "commander";
import { loadConfig } from "#core/config/config.js";
import { createModelClient } from "#core/model/model-client.js";
import { loadModuleMetadata } from "#core/modules/module-metadata.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { DaemonControlClient } from "#core/server/daemon-client.js";
import { validateWorkflowDefinitions, WorkflowDefinitionError } from "#core/workflow/validation.js";
import { resolveApiKey } from "#modules/model-clients/factory.js";

type CheckStatus = "pass" | "warn" | "fail";

export type CheckResult = {
  label: string;
  status: CheckStatus;
  detail?: string;
};

type RepairAction = "repaired" | "skipped" | "manual";

export type RepairResult = {
  item: string;
  action: RepairAction;
  detail?: string;
};

import { isProcessAlive } from "#core/util/process-alive.js";

function readDaemonPid(statePath: string): number | null {
  if (!existsSync(statePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf-8")) as { pid?: unknown };
    return typeof parsed.pid === "number" ? parsed.pid : null;
  } catch {
    return null;
  }
}

export function runDoctorFixes(projectDir: string): RepairResult[] {
  const results: RepairResult[] = [];
  const kotaDir = join(projectDir, ".kota");
  const lockFile = join(kotaDir, "daemon-control.json");
  const daemonStateFile = join(kotaDir, "daemon-state.json");

  if (existsSync(lockFile)) {
    try {
      const addr = JSON.parse(readFileSync(lockFile, "utf-8")) as { pid?: number };
      if (typeof addr.pid === "number" && !isProcessAlive(addr.pid)) {
        unlinkSync(lockFile);
        results.push({
          item: "Daemon lock file (.kota/daemon-control.json)",
          action: "repaired",
          detail: `Removed stale lock file (pid ${addr.pid} not alive)`,
        });
      } else {
        results.push({
          item: "Daemon lock file (.kota/daemon-control.json)",
          action: "skipped",
          detail: "Daemon process is alive",
        });
      }
    } catch {
      results.push({
        item: "Daemon lock file (.kota/daemon-control.json)",
        action: "manual",
        detail: "Could not parse lock file — inspect and remove manually if stale",
      });
    }
  } else {
    results.push({
      item: "Daemon lock file (.kota/daemon-control.json)",
      action: "skipped",
      detail: "No lock file present",
    });
  }

  if (existsSync(daemonStateFile)) {
    const pid = readDaemonPid(daemonStateFile);
    if (typeof pid === "number" && !isProcessAlive(pid)) {
      unlinkSync(daemonStateFile);
      results.push({
        item: "Daemon state file (.kota/daemon-state.json)",
        action: "repaired",
        detail: `Removed stale daemon state (pid ${pid} not alive)`,
      });
    } else {
      results.push({
        item: "Daemon state file (.kota/daemon-state.json)",
        action: "skipped",
        detail: pid ? "Daemon process is alive" : "State file present",
      });
    }
  } else {
    results.push({
      item: "Daemon state file (.kota/daemon-state.json)",
      action: "skipped",
      detail: "No state file present",
    });
  }

  for (const dir of [kotaDir, join(kotaDir, "runs"), join(kotaDir, "modules")]) {
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
        results.push({ item: `Directory: ${dir}`, action: "repaired", detail: "Created" });
      } catch (err) {
        results.push({
          item: `Directory: ${dir}`,
          action: "manual",
          detail: `Could not create: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    } else {
      results.push({ item: `Directory: ${dir}`, action: "skipped", detail: "Already present" });
    }
  }

  for (const strayDir of ["runs", "kota"]) {
    const strayPath = join(projectDir, strayDir);
    if (existsSync(strayPath)) {
      try {
        rmSync(strayPath, { recursive: true, force: true });
        results.push({
          item: `Stray directory: ${strayDir}/`,
          action: "repaired",
          detail: `Removed stray runtime directory outside .kota/`,
        });
      } catch (err) {
        results.push({
          item: `Stray directory: ${strayDir}/`,
          action: "manual",
          detail: `Could not remove: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  return results;
}

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
    results.push(pass("Disk: .kota/ writable"));
    try {
      unlinkSync(tmpFile);
    } catch (err) {
      results.push(warn("Disk: .kota/ cleanup", err instanceof Error ? err.message : String(err)));
    }
  } catch {
    results.push(fail("Disk: .kota/ writable", "Directory is not writable"));
  }

  const modulesDir = join(kotaDir, "modules");
  if (existsSync(modulesDir)) {
    results.push(pass("Disk: .kota/modules/", "Present"));
  } else {
    results.push(warn("Disk: .kota/modules/", "Missing — run `kota doctor --fix` to create canonical module state"));
  }

  const unexpectedKotaSubdirs = ["extensions"];
  for (const sub of unexpectedKotaSubdirs) {
    const subPath = join(kotaDir, sub);
    if (existsSync(subPath)) {
      results.push(warn(`Disk: stray .kota/${sub}/`, `Remove this directory — it is no longer used`));
    }
  }

  for (const strayDir of ["runs", "kota"]) {
    const strayPath = join(projectDir, strayDir);
    if (existsSync(strayPath)) {
      results.push(
        warn(
          `Disk: stray ${strayDir}/`,
          `Unexpected runtime artifact directory outside .kota/: ${strayPath}`,
        ),
      );
    }
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

async function checkWorkflowDefinitions(projectDir: string): Promise<CheckResult> {
  try {
    const loader = await loadModuleMetadata(loadConfig(projectDir), projectDir, false);
    const defs = loader.getContributedWorkflows();
    const validated = validateWorkflowDefinitions(defs, projectDir);
    return pass("Workflows: discoverable definitions", `${validated.length} valid`);
  } catch (err) {
    if (err instanceof WorkflowDefinitionError) {
      return fail("Workflows: discoverable definitions", err.message);
    }
    return fail("Workflows: discoverable definitions", String(err));
  }
}

async function checkModules(projectDir: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  try {
    const loader = await loadModuleMetadata(loadConfig(projectDir), projectDir, false);
    const summaries = loader.getModuleSummaries();
    results.push(pass("Modules: loaded", `${summaries.length} module(s)`));
  } catch (err) {
    results.push(fail("Modules: loaded", `Load error: ${err instanceof Error ? err.message : String(err)}`));
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

function isAuthError(err: unknown): boolean {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /API error (401|403)/i.test(msg);
}

/** Default cheap probe model per provider type. */
const PROBE_MODEL: Record<string, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
};

export async function checkProviderConnectivity(projectDir: string): Promise<CheckResult[]> {
  const config = loadConfig(projectDir);
  const mpConfig = config.modelProvider;
  const providerType = mpConfig?.type ?? "anthropic";
  const explicitKey = mpConfig?.apiKey;
  const baseUrl = mpConfig?.baseUrl;
  const apiKey = resolveApiKey(providerType, explicitKey);
  const model = PROBE_MODEL[providerType] ?? config.model ?? "gpt-4o-mini";

  const label = `Provider connectivity: ${providerType}`;
  const keyDisplay = apiKey ? `${apiKey.slice(0, 8)}...` : "(not set)";

  if (!apiKey) {
    const envHint = providerType === "anthropic" ? "ANTHROPIC_API_KEY" : `${providerType.toUpperCase()}_API_KEY`;
    return [warn(label, `API key not set — export ${envHint} or add apiKey to config.modelProvider`)];
  }

  try {
    const { client } = createModelClient({ model, provider: providerType, baseUrl, apiKey });
    await client.messages.create({
      model,
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });
    return [pass(label, `Reachable (model: ${model}, key: ${keyDisplay})`)];
  } catch (err) {
    if (isAuthError(err)) {
      return [fail(label, `Authentication failed (key: ${keyDisplay})`)];
    }
    const msg = err instanceof Error ? err.message : String(err);
    return [fail(label, `Unreachable — ${msg.slice(0, 120)}`)];
  }
}

export async function runDoctorChecks(
  projectDir: string,
  opts?: { skipConnectivity?: boolean },
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Daemon check
  const kotaDir = join(projectDir, ".kota");
  const client = DaemonControlClient.fromStateDir(kotaDir);
  const status = client ? await client.getDaemonStatus() : null;
  const daemonStatePath = join(kotaDir, "daemon-state.json");
  const staleDaemonPid = readDaemonPid(daemonStatePath);

  const controlFilePid = readDaemonPid(join(kotaDir, "daemon-control.json"));

  if (!client) {
    if (typeof staleDaemonPid === "number" && !isProcessAlive(staleDaemonPid)) {
      results.push(warn("Daemon", `Daemon is not running and .kota/daemon-state.json is stale (pid ${staleDaemonPid}) — run 'kota doctor --fix'`));
    } else {
      results.push(warn("Daemon", "No daemon-control.json found — daemon is not running"));
    }
  } else if (!status) {
    // Control file exists but API is unreachable — check if the PID is even alive.
    if (typeof controlFilePid === "number" && !isProcessAlive(controlFilePid)) {
      results.push(fail("Daemon", `Stale daemon-control.json (pid ${controlFilePid} is not alive) — run 'kota doctor --fix' to clean up`));
    } else {
      results.push(fail("Daemon", `Control file present (pid ${controlFilePid ?? "?"}) but API is unreachable — daemon may have crashed`));
    }
  } else {
    results.push(pass("Daemon", `Running (pid ${status.pid ?? "?"}, started ${status.startedAt ?? "?"})`));
  }

  // Config checks
  const globalConfigPath = join(homedir(), ".kota", "config.json");
  const projectConfigPath = join(projectDir, ".kota", "config.json");
  results.push(checkConfigFile(globalConfigPath, "Config: global (~/.kota/config.json)"));
  results.push(checkConfigFile(projectConfigPath, "Config: project (.kota/config.json)"));

  // Module checks (skip if daemon running to avoid double-load issues)
  if (status) {
    results.push(pass("Modules", "Managed by daemon (use `kota module list` for details)"));
    const healthResp = await client!.getHealth();
    const moduleChecks = healthResp?.components?.moduleHealthChecks;
    if (moduleChecks && Object.keys(moduleChecks).length > 0) {
      for (const [name, check] of Object.entries(moduleChecks)) {
        const detail = check.message ? `${check.status} — ${check.message}` : check.status;
        if (check.status === "healthy") {
          results.push(pass(`Module health: ${name}`, detail));
        } else if (check.status === "degraded") {
          results.push(warn(`Module health: ${name}`, detail));
        } else {
          results.push(fail(`Module health: ${name}`, detail));
        }
      }
    }
  } else {
    const extResults = await checkModules(projectDir);
    results.push(...extResults);
  }

  // Provider checks
  results.push(...checkProvidersConfig(projectDir));

  // Provider connectivity probe
  if (opts?.skipConnectivity) {
    results.push(warn("Provider connectivity", "Skipped (--skip-connectivity)"));
  } else {
    results.push(...(await checkProviderConnectivity(projectDir)));
  }

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
    results.push(await checkWorkflowDefinitions(projectDir));
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

function repairIcon(action: RepairAction): string {
  if (action === "repaired") return "+";
  if (action === "skipped") return "·";
  return "!";
}

function printRepairs(repairs: RepairResult[]): void {
  const labelWidth = Math.max(...repairs.map((r) => r.item.length), 10);
  for (const r of repairs) {
    const icon = repairIcon(r.action);
    const label = r.item.padEnd(labelWidth);
    const detail = r.detail ? `  ${r.detail}` : "";
    console.log(`  [${icon}] ${label}${detail}`);
  }
}

function buildDoctorCommand(_ctx: ModuleContext): Command {
  const cmd = new Command("doctor")
    .description("Run runtime health checks and print a pass/warn/fail summary")
    .option("--json", "Output results as JSON")
    .option("--fix", "Apply safe automatic repairs for fixable issues")
    .option("--skip-connectivity", "Skip provider API connectivity probes (for offline environments)")
    .action(async (opts: { json?: boolean; fix?: boolean; skipConnectivity?: boolean }) => {
      const projectDir = process.cwd();
      const results = await runDoctorChecks(projectDir, { skipConnectivity: opts.skipConnectivity });
      const repairs = opts.fix ? runDoctorFixes(projectDir) : [];

      if (opts.json) {
        console.log(JSON.stringify(opts.fix ? { checks: results, repairs } : results, null, 2));
      } else {
        console.log("\nKOTA Health Check\n");
        printResults(results);
        const failCount = results.filter((r) => r.status === "fail").length;
        const warnCount = results.filter((r) => r.status === "warn").length;
        console.log(
          `\n${results.length} check(s): ${results.length - failCount - warnCount} passed, ${warnCount} warned, ${failCount} failed`,
        );

        if (opts.fix) {
          const repairedCount = repairs.filter((r) => r.action === "repaired").length;
          const manualCount = repairs.filter((r) => r.action === "manual").length;
          console.log("\nAuto-Repair\n");
          printRepairs(repairs);
          console.log(
            `\n${repairs.length} repair(s): ${repairedCount} repaired, ${repairs.length - repairedCount - manualCount} skipped, ${manualCount} require manual action`,
          );
        }
      }

      const anyFail = results.some((r) => r.status === "fail");
      if (anyFail) process.exit(1);
    });

  return cmd;
}

const doctorModule: KotaModule = {
  name: "doctor",
  version: "1.0.0",
  description: "Runtime health checks — daemon, config, modules, providers, workflows, and disk",
  commands: (ctx: ModuleContext) => [buildDoctorCommand(ctx)],
};

export default doctorModule;
