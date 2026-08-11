import { resolve } from "node:path";
import { resolveAgentHarness } from "#core/agent-harness/index.js";
import { loadConfig } from "#core/config/config.js";
import {
  PRESET_ENV_VAR,
  resolveActivePresetFromConfig,
} from "#core/model/preset.js";
import type { EvalRunOptions } from "./client.js";
import type { ResourceProfile } from "./fixture-run.js";
import {
  type ProviderEgressTaskSubprocessBoundaryRequest,
  providerEgressAuthEnvKeysFor,
} from "./provider-egress.js";
import type { WorkflowExecutor } from "./runner.js";
import {
  createSubprocessExecutor,
  detectHostSubprocessResourceProfile,
  type SubprocessIsolationBackend,
} from "./subprocess-executor.js";

export const DEFAULT_HOST_CLASS = "local-dev";

function isolationBackendForRun(
  options: EvalRunOptions,
): SubprocessIsolationBackend {
  return options.isolationBackend ?? { kind: "host-subprocess" };
}

function providerEgressTaskBoundaryForRun(
  projectDir: string,
  backend: SubprocessIsolationBackend,
  env: NodeJS.ProcessEnv,
): ProviderEgressTaskSubprocessBoundaryRequest | undefined {
  if (
    backend.kind !== "container" ||
    backend.networkPolicy?.kind !== "provider-egress"
  ) {
    return undefined;
  }
  const activePreset = resolveActivePresetFromConfig(loadConfig(projectDir), env);
  const harness = resolveAgentHarness(activePreset.harness);
  return {
    agentHarness: activePreset.harness,
    toolControl: harness.toolControl,
  };
}

function envForKeys(
  keys: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> | undefined {
  const authEnv: Record<string, string> = {};
  for (const key of keys) {
    const value = env[key];
    if (value !== undefined) authEnv[key] = value;
  }
  return Object.keys(authEnv).length > 0 ? authEnv : undefined;
}

function providerEgressAuthEnvForRun(
  backend: SubprocessIsolationBackend,
  env: NodeJS.ProcessEnv,
): Record<string, string> | undefined {
  if (
    backend.kind !== "container" ||
    backend.networkPolicy?.kind !== "provider-egress"
  ) {
    return undefined;
  }
  return envForKeys(
    providerEgressAuthEnvKeysFor(backend.networkPolicy.provider),
    env,
  );
}

function isolatedHostAuthEnvForRun(
  activePreset: ReturnType<typeof resolveActivePresetFromConfig>,
  backend: SubprocessIsolationBackend,
  env: NodeJS.ProcessEnv,
): Readonly<Record<string, string>> {
  if (backend.kind !== "host-subprocess" || activePreset.authEnv.length > 0) {
    return {};
  }
  const harness = resolveAgentHarness(activePreset.harness);
  return harness.resolveIsolatedHostAuthEnv?.(env) ?? {};
}

export function executorExtraEnvForRun(
  projectDir: string,
  backend: SubprocessIsolationBackend,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const activePreset = resolveActivePresetFromConfig(loadConfig(projectDir), env);
  return {
    [PRESET_ENV_VAR]: activePreset.id,
    ...(envForKeys(activePreset.authEnv, env) ?? {}),
    ...isolatedHostAuthEnvForRun(activePreset, backend, env),
    ...(providerEgressAuthEnvForRun(backend, env) ?? {}),
  };
}

function buildProfile(options: EvalRunOptions): ResourceProfile {
  const hostClass = options.hostClass ?? DEFAULT_HOST_CLASS;
  const detected = detectHostSubprocessResourceProfile(hostClass);
  const cpuAllocationCores =
    options.cpuAllocationCores ?? detected.cpuAllocationCores;
  const cpuKillThresholdCores =
    options.cpuKillThresholdCores ?? cpuAllocationCores;
  const memoryAllocationMB =
    options.memoryAllocationMB ?? detected.memoryAllocationMB;
  const memoryKillThresholdMB =
    options.memoryKillThresholdMB ?? memoryAllocationMB;
  return {
    hostClass,
    cpuAllocationCores,
    cpuKillThresholdCores,
    memoryAllocationMB,
    memoryKillThresholdMB,
  };
}

export type EvalRunExecution = {
  executor: WorkflowExecutor;
  requestedProfile: ResourceProfile;
  isolationBackend: SubprocessIsolationBackend;
  executorEnv: Record<string, string>;
};

export function createEvalRunExecution(
  projectDir: string,
  options: EvalRunOptions,
  env: NodeJS.ProcessEnv = process.env,
): EvalRunExecution {
  const isolationBackend = isolationBackendForRun(options);
  const executorEnv = executorExtraEnvForRun(projectDir, isolationBackend, env);
  return {
    executor: createSubprocessExecutor({
      kotaBinaryPath: resolve(projectDir, "bin/kota.mjs"),
      isolationBackend,
      extraEnv: executorEnv,
      providerEgressTaskBoundary: providerEgressTaskBoundaryForRun(
        projectDir,
        isolationBackend,
        env,
      ),
    }),
    requestedProfile: buildProfile(options),
    isolationBackend,
    executorEnv,
  };
}
