import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NATIVE_CLI_EGRESS_UPSTREAM_PROXY_ENV } from "#core/agent-harness/native-cli-egress-proxy.js";
import { PRESET_ENV_VAR, resolvePreset } from "#core/model/preset.js";
import { envWithoutSourceConditionNodeOption } from "#core/util/node-options.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import {
  type ExecutionNetworkPolicy,
  providerEgressAuthEnvKeysFor,
  providerEgressEndpointLabelValue,
} from "./provider-egress.js";
import { REPLAY_AGENT_HARNESS_NAME_ENV } from "./replay-harness.js";
import type { WorkflowExecutionRequest } from "./runner.js";
import type {
  ContainerEnvFile,
  SubprocessExecutorOptions,
} from "./subprocess-executor-types.js";

const REPLAY_PRESET_ID = "claude";
const CONTAINER_DEFAULT_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const DOCKER_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HOST_RUNTIME_PARENT_ENV_KEYS = [
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NODE_OPTIONS",
  "TERM",
  "TMPDIR",
  "TEMP",
  "TMP",
] as const;

function envWithReplay(
  request: WorkflowExecutionRequest,
): Record<string, string> {
  return request.replayRecordingsRoot !== undefined
    ? {
        [PRESET_ENV_VAR]: REPLAY_PRESET_ID,
        [REPLAY_AGENT_HARNESS_NAME_ENV]: request.replayRecordingsRoot,
      }
    : {};
}

function distCliExecutionEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return envWithoutSourceConditionNodeOption(env);
}

function prepareFixtureRuntimeEnv(workingDir: string): Record<string, string> {
  const runtimeRoot = join(
    workingDir,
    "node_modules",
    ".kota-eval-runtime",
  );
  const machineHome = join(runtimeRoot, "home");
  // Reset the isolated home on every invocation so fixture output cannot
  // persist machine state across workflow rounds. Eval execution must not
  // synthesize trust: fixture-local modules remain subject to the same
  // operator-owned authority decision as every other installed module.
  rmSync(machineHome, { recursive: true, force: true });
  mkdirSync(machineHome, { recursive: true, mode: 0o700 });
  return {
    HOME: machineHome,
    COREPACK_HOME: join(runtimeRoot, "corepack"),
    PNPM_HOME: join(runtimeRoot, "pnpm-home"),
    XDG_CACHE_HOME: join(runtimeRoot, "cache"),
    XDG_DATA_HOME: join(runtimeRoot, "data"),
    XDG_STATE_HOME: join(runtimeRoot, "state"),
    npm_config_cache: join(runtimeRoot, "npm-cache"),
    npm_config_store_dir: join(runtimeRoot, "pnpm-store"),
  };
}

function hostParentExecutionEnv(
  options: SubprocessExecutorOptions,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of HOST_RUNTIME_PARENT_ENV_KEYS) {
    const value = baseEnv[key];
    if (value !== undefined) env[key] = value;
  }

  const presetId = options.extraEnv?.[PRESET_ENV_VAR] ?? baseEnv[PRESET_ENV_VAR];
  if (presetId !== undefined) env[PRESET_ENV_VAR] = presetId;
  const activePreset = resolvePreset({ env: presetId }).preset;
  for (const key of activePreset.authEnv) {
    const value = options.extraEnv?.[key] ?? baseEnv[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export function hostExecutionEnv(
  options: SubprocessExecutorOptions,
  request: WorkflowExecutionRequest,
  kotaDistDir: string,
): NodeJS.ProcessEnv {
  const basePath =
    options.extraEnv?.PATH ?? process.env.PATH ?? CONTAINER_DEFAULT_PATH;
  const pathWithShims =
    request.externalCallShimDir !== undefined
      ? `${request.externalCallShimDir}:${basePath}`
      : basePath;
  return distCliExecutionEnv(
    withProtectedGitBareRepositoryEnv({
      ...hostParentExecutionEnv(options),
      ...(options.extraEnv ?? {}),
      KOTA_SCOPE_ROOT: request.workingDir,
      KOTA_DIST_DIR: kotaDistDir,
      PATH: pathWithShims,
      ...prepareFixtureRuntimeEnv(request.workingDir),
      ...envWithReplay(request),
    }),
  );
}

export function containerExecutionEnv(
  options: SubprocessExecutorOptions,
  request: WorkflowExecutionRequest,
  kotaDistDir: string,
  networkPolicy: ExecutionNetworkPolicy,
): Record<string, string> {
  const basePath = options.extraEnv?.PATH ?? CONTAINER_DEFAULT_PATH;
  const pathWithShims =
    request.externalCallShimDir !== undefined
      ? `${request.externalCallShimDir}:${basePath}`
      : basePath;
  const env = distCliExecutionEnv(
    withProtectedGitBareRepositoryEnv({
      ...(options.extraEnv ?? {}),
      KOTA_SCOPE_ROOT: request.workingDir,
      KOTA_DIST_DIR: kotaDistDir,
      PATH: pathWithShims,
      ...prepareFixtureRuntimeEnv(request.workingDir),
      ...containerNetworkEnv(networkPolicy),
      ...envWithReplay(request),
    }),
  );
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function containerNetworkEnv(
  networkPolicy: ExecutionNetworkPolicy,
): Record<string, string> {
  if (
    networkPolicy.kind !== "provider-egress" ||
    networkPolicy.enforcementMode !== "docker-internal-proxy"
  ) {
    return {};
  }
  const endpoints = providerEgressEndpointLabelValue(
    networkPolicy.allowedProviderEndpoints,
  );
  return {
    KOTA_EVAL_PROVIDER_EGRESS_ACTIVE: "1",
    KOTA_EVAL_PROVIDER_EGRESS_AUTH_ENV_KEYS:
      providerEgressAuthEnvKeysFor(networkPolicy.provider).join(","),
    HTTP_PROXY: networkPolicy.proxyUrl,
    HTTPS_PROXY: networkPolicy.proxyUrl,
    [NATIVE_CLI_EGRESS_UPSTREAM_PROXY_ENV]: networkPolicy.proxyUrl,
    NODE_USE_ENV_PROXY: "1",
    KOTA_EVAL_PROVIDER_EGRESS_ENDPOINTS: endpoints,
    KOTA_EVAL_PROVIDER_EGRESS_PROVIDER: networkPolicy.provider,
    KOTA_EVAL_PROVIDER_EGRESS_PROXY_URL: networkPolicy.proxyUrl,
    KOTA_EVAL_PROVIDER_EGRESS_SCOPE: networkPolicy.containerNetworkScope,
    KOTA_EVAL_PROVIDER_EGRESS_TASK_BOUNDARY:
      networkPolicy.taskSubprocessBoundary.kind,
    ...(networkPolicy.taskSubprocessBoundary.kind !==
    "agent-harness-unresolved"
      ? {
          KOTA_EVAL_PROVIDER_EGRESS_AGENT_HARNESS:
            networkPolicy.taskSubprocessBoundary.agentHarness,
        }
      : {}),
  };
}

function dockerEnvFileContent(env: Record<string, string>): string {
  return Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      if (!DOCKER_ENV_KEY_PATTERN.test(key)) {
        throw new Error(`Container env key "${key}" is not a valid env name.`);
      }
      if (value.includes("\n") || value.includes("\r")) {
        throw new Error(
          `Container env value for "${key}" cannot contain line breaks.`,
        );
      }
      return `${key}=${value}`;
    })
    .join("\n")
    .concat("\n");
}

export function writeContainerEnvFile(
  env: Record<string, string>,
): ContainerEnvFile {
  const dir = mkdtempSync(join(tmpdir(), "kota-eval-container-env-"));
  const path = join(dir, "env");
  writeFileSync(path, dockerEnvFileContent(env), {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(path, 0o600);
  return {
    path,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function dockerCliEnv(networkPolicy: ExecutionNetworkPolicy): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (networkPolicy.kind === "provider-egress") {
    for (const key of providerEgressAuthEnvKeysFor(networkPolicy.provider)) {
      delete env[key];
    }
  }
  return env;
}
