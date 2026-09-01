/**
 * Doctor health checks and auto-repair logic.
 *
 * Both the local-side `doctor` namespace handler and the daemon-control
 * routes share these helpers so daemon-up and daemon-down operators see
 * the same pass/info/warn/fail decisions for the same project state.
 */
import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "#core/config/config.js";
import type { CapabilityReadinessResponse } from "#core/daemon/capability-readiness.js";
import type {
  DaemonLiveStatus,
  HealthStatus,
  WorkflowDefinitionSummary,
} from "#core/daemon/daemon-control.js";
import { detectStrandedDaemonProcess } from "#core/daemon/stranded-daemon.js";
import { resolveAgentRuntime } from "#core/model/preset.js";
import { loadModuleMetadata } from "#core/modules/module-metadata.js";
import { getDaemonTransport } from "#core/server/daemon-transport.js";
import { isProcessAlive } from "#core/util/process-alive.js";
import { validateWorkflowDefinitions, WorkflowDefinitionError } from "#core/workflow/validation.js";
import type {
  DoctorCheckResult,
  DoctorRepairResult,
  DoctorRunResult,
} from "./client.js";
import { listStaleRunInsightFiles } from "./doctor-fixes.js";
import {
  checkPresetHarnessReadiness,
  extractPresetReadiness,
} from "./doctor-preset-readiness.js";
import {
  checkProviderConnectivity,
  checkProvidersConfig,
} from "./doctor-provider-checks.js";
import { fail, pass, warn } from "./doctor-results.js";

export { runDoctorFixes } from "./doctor-fixes.js";
export { checkProviderConnectivity } from "./doctor-provider-checks.js";

export type CheckResult = DoctorCheckResult;
export type RepairResult = DoctorRepairResult;

function readDaemonPid(statePath: string): number | null {
  if (!existsSync(statePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf-8")) as { pid?: unknown };
    return typeof parsed.pid === "number" ? parsed.pid : null;
  } catch {
    return null;
  }
}

function checkDisk(scopeRoot: string): CheckResult[] {
  const results: CheckResult[] = [];
  const kotaDir = join(scopeRoot, ".kota");

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
    const strayPath = join(scopeRoot, strayDir);
    if (existsSync(strayPath)) {
      results.push(
        warn(
          `Disk: stray ${strayDir}/`,
          `Unexpected runtime artifact directory outside .kota/: ${strayPath}`,
        ),
      );
    }
  }

  const staleRunInsightFiles = listStaleRunInsightFiles(scopeRoot);
  if (staleRunInsightFiles.length > 0) {
    results.push(warn(
      "Disk: stale run-insight data",
      `${staleRunInsightFiles.length} file(s) in .kota/data/ repeat git history and .kota/runs; run \`kota doctor --fix\` to remove them`,
    ));
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

async function checkWorkflowDefinitions(scopeRoot: string): Promise<CheckResult> {
  try {
    const config = loadConfig(scopeRoot);
    const loader = await loadModuleMetadata(config, scopeRoot, false);
    const defs = loader.getContributedWorkflows();
    const runtime = resolveAgentRuntime(config);
    const validated = validateWorkflowDefinitions(defs, scopeRoot, {
      defaultAgentHarness: runtime.harness,
      defaultAgentEffort: runtime.effort,
      preset: runtime.preset,
      modelTiers: runtime.tiers,
      agentModels: config.agentModels,
      resolveAgentDef: (name) => loader.getAgentDef(name),
    });
    return pass("Workflows: discoverable definitions", `${validated.length} valid`);
  } catch (err) {
    if (err instanceof WorkflowDefinitionError) {
      return fail("Workflows: discoverable definitions", err.message);
    }
    return fail("Workflows: discoverable definitions", String(err));
  }
}

async function checkModules(scopeRoot: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  try {
    const loader = await loadModuleMetadata(loadConfig(scopeRoot), scopeRoot, false);
    const summaries = loader.getModuleSummaries();
    results.push(pass("Modules: loaded", `${summaries.length} module(s)`));
  } catch (err) {
    results.push(fail("Modules: loaded", `Load error: ${err instanceof Error ? err.message : String(err)}`));
  }
  return results;
}

export async function runDoctorChecks(
  scopeRoot: string,
  opts?: { skipConnectivity?: boolean; preset?: string },
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const kotaDir = join(scopeRoot, ".kota");
  const link = getDaemonTransport(kotaDir);
  const status = link ? await link.request<DaemonLiveStatus>("GET", "/status") : null;
  const controlFilePid = readDaemonPid(join(kotaDir, "daemon-control.json"));
  const strandedDaemon = detectStrandedDaemonProcess(scopeRoot);

  if (!link) {
    if (strandedDaemon.kind === "stranded") {
      results.push(fail(
        "Daemon",
        `Daemon process pid ${strandedDaemon.pid} is alive but no daemon-control.json/control API is published — terminate it and restart`,
      ));
    } else {
      results.push(warn("Daemon", "No daemon-control.json found — daemon is not running"));
    }
  } else if (!status) {
    if (typeof controlFilePid === "number" && !isProcessAlive(controlFilePid)) {
      results.push(fail("Daemon", `Stale daemon-control.json (pid ${controlFilePid} is not alive) — run 'kota doctor --fix' to clean up`));
    } else {
      results.push(fail("Daemon", `Control file present (pid ${controlFilePid ?? "?"}) but API is unreachable — daemon may have crashed`));
    }
  } else {
    results.push(pass("Daemon", `Running (pid ${status.pid ?? "?"}, started ${status.startedAt ?? "?"})`));
  }

  const globalConfigPath = join(homedir(), ".kota", "config.json");
  const scopeConfigPath = join(scopeRoot, ".kota", "config.json");
  results.push(checkConfigFile(globalConfigPath, "Config: global (~/.kota/config.json)"));
  results.push(checkConfigFile(scopeConfigPath, "Config: project (.kota/config.json)"));

  if (status) {
    results.push(pass("Modules", "Managed by daemon (use `kota module list` for details)"));
    if (link) {
      const healthResp = await link.request<{ status: string; components: HealthStatus }>(
        "GET",
        "/health",
      );
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
      const capabilities = await link.request<CapabilityReadinessResponse>(
        "GET",
        "/capabilities",
      );
      if (capabilities) {
        for (const cap of capabilities.capabilities) {
          const detail = cap.message ?? cap.reason ?? cap.status;
          if (cap.status === "ready") {
            results.push(pass(`Capability: ${cap.id}`, detail));
          } else if (cap.status === "unavailable") {
            results.push(warn(`Capability: ${cap.id}`, detail));
          } else {
            results.push(fail(`Capability: ${cap.id}`, detail));
          }
        }
      }
    }
  } else {
    const extResults = await checkModules(scopeRoot);
    results.push(...extResults);
  }

  results.push(...checkPresetHarnessReadiness(scopeRoot, opts?.preset));

  results.push(...checkProvidersConfig(scopeRoot));

  if (opts?.skipConnectivity) {
    results.push(warn("Provider connectivity", "Skipped (--skip-connectivity)"));
  } else {
    results.push(...(await checkProviderConnectivity(scopeRoot)));
  }

  if (status && link) {
    const defResult = await link.request<{ definitions: WorkflowDefinitionSummary[] }>(
      "GET",
      "/workflow/definitions",
    );
    if (!defResult) {
      results.push(warn("Workflows", "Could not fetch definitions from daemon"));
    } else {
      const count = defResult.definitions.length;
      results.push(pass("Workflows", `${count} definition(s) loaded by daemon`));
    }
  } else {
    results.push(await checkWorkflowDefinitions(scopeRoot));
  }

  results.push(...checkDisk(scopeRoot));

  return results;
}

export async function runDoctorReport(
  scopeRoot: string,
  opts?: { skipConnectivity?: boolean; preset?: string },
): Promise<DoctorRunResult> {
  const checks = await runDoctorChecks(scopeRoot, opts);
  const presetReadiness = extractPresetReadiness(checks);
  return presetReadiness ? { checks, presetReadiness } : { checks };
}
