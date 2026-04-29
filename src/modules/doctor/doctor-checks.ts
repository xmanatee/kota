/**
 * Doctor health checks and auto-repair logic.
 *
 * Both the local-side `doctor` namespace handler and the daemon-control
 * routes share these helpers so daemon-up and daemon-down operators see
 * the same pass/warn/fail decisions for the same project state.
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
import { loadConfig } from "#core/config/config.js";
import { createModelClient } from "#core/model/model-client.js";
import { loadModuleMetadata } from "#core/modules/module-metadata.js";
import { DaemonControlClient } from "#core/server/daemon-client.js";
import type {
  DoctorCheckResult,
  DoctorRepairResult,
} from "#core/server/kota-client.js";
import { isProcessAlive } from "#core/util/process-alive.js";
import { validateWorkflowDefinitions, WorkflowDefinitionError } from "#core/workflow/validation.js";
import { resolveApiKey } from "#modules/model-clients/factory.js";

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

export function runDoctorFixes(projectDir: string): RepairResult[] {
  const results: RepairResult[] = [];
  const kotaDir = join(projectDir, ".kota");
  const lockFile = join(kotaDir, "daemon-control.json");

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
  return detail !== undefined
    ? { label, status: "pass", detail }
    : { label, status: "pass" };
}

function warn(label: string, detail?: string): CheckResult {
  return detail !== undefined
    ? { label, status: "warn", detail }
    : { label, status: "warn" };
}

function fail(label: string, detail?: string): CheckResult {
  return detail !== undefined
    ? { label, status: "fail", detail }
    : { label, status: "fail" };
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
    const config = loadConfig(projectDir);
    const loader = await loadModuleMetadata(config, projectDir, false);
    const defs = loader.getContributedWorkflows();
    const validated = validateWorkflowDefinitions(defs, projectDir, {
      defaultAgentHarness: config.defaultAgentHarness,
    });
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

  const kotaDir = join(projectDir, ".kota");
  const client = DaemonControlClient.fromStateDir(kotaDir);
  const status = client ? await client.getDaemonStatus() : null;
  const controlFilePid = readDaemonPid(join(kotaDir, "daemon-control.json"));

  if (!client) {
    results.push(warn("Daemon", "No daemon-control.json found — daemon is not running"));
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
  const projectConfigPath = join(projectDir, ".kota", "config.json");
  results.push(checkConfigFile(globalConfigPath, "Config: global (~/.kota/config.json)"));
  results.push(checkConfigFile(projectConfigPath, "Config: project (.kota/config.json)"));

  if (status) {
    results.push(pass("Modules", "Managed by daemon (use `kota module list` for details)"));
    if (client) {
      const healthResp = await client.getHealth();
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
      const capabilities = await client.getCapabilities();
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
    const extResults = await checkModules(projectDir);
    results.push(...extResults);
  }

  results.push(...checkProvidersConfig(projectDir));

  if (opts?.skipConnectivity) {
    results.push(warn("Provider connectivity", "Skipped (--skip-connectivity)"));
  } else {
    results.push(...(await checkProviderConnectivity(projectDir)));
  }

  if (status && client) {
    const defResult = await client.getWorkflowDefinitions();
    if (!defResult) {
      results.push(warn("Workflows", "Could not fetch definitions from daemon"));
    } else {
      const count = defResult.definitions.length;
      results.push(pass("Workflows", `${count} definition(s) loaded by daemon`));
    }
  } else {
    results.push(await checkWorkflowDefinitions(projectDir));
  }

  results.push(...checkDisk(projectDir));

  return results;
}
