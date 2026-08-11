import { dirname, isAbsolute, join, relative } from "node:path";
import type { ExecutionProfilePreflightResult } from "./fixture-run.js";
import type { ExecutionNetworkPolicy } from "./provider-egress.js";
import type { WorkflowExecutionRequest } from "./runner.js";
import type { ContainerIsolationBackend } from "./subprocess-executor-types.js";

function memoryArg(mb: number): string {
  return `${mb}m`;
}

function cpuArg(cores: number): string {
  return String(cores);
}

export function containerKotaDistDir(
  backend: ContainerIsolationBackend,
): string {
  if (!isAbsolute(backend.kotaBinaryPath)) {
    throw new Error(
      "Container isolation backend requires an absolute image-local kotaBinaryPath.",
    );
  }
  return join(dirname(dirname(backend.kotaBinaryPath)), "dist");
}

export function workflowExecArgs(
  kotaBinaryPath: string,
  request: WorkflowExecutionRequest,
): string[] {
  const args = [kotaBinaryPath, "workflow", "exec", request.workflowName];
  if (request.agentExecutionOverride !== undefined) {
    args.push(
      "--agent-harness",
      request.agentExecutionOverride.harness,
      "--agent-model",
      request.agentExecutionOverride.model,
    );
    if (request.agentExecutionOverride.effort !== undefined) {
      args.push("--agent-effort", request.agentExecutionOverride.effort);
    }
  }
  if (request.triggerPayload !== undefined) {
    args.push("--payload", JSON.stringify(request.triggerPayload));
  }
  return args;
}

export function containerRunArgs(params: {
  backend: ContainerIsolationBackend;
  executionProfile: ExecutionProfilePreflightResult;
  workingDir: string;
  replayRecordingsRoot?: string;
  envFilePath: string;
  command: string;
  commandArgs: string[];
}): string[] {
  const profile = params.executionProfile.observedOrEnforcedProfile;
  const networkPolicy = params.executionProfile.networkPolicy;
  const mountArgs = containerMountArgs({
    workingDir: params.workingDir,
    replayRecordingsRoot: params.replayRecordingsRoot,
  });
  return [
    "run",
    "--rm",
    "--init",
    ...containerNetworkArgs(networkPolicy),
    "--cpus",
    cpuArg(profile.cpuKillThresholdCores),
    "--memory-reservation",
    memoryArg(profile.memoryAllocationMB),
    "--memory",
    memoryArg(profile.memoryKillThresholdMB),
    ...mountArgs,
    "--workdir",
    params.workingDir,
    "--env-file",
    params.envFilePath,
    params.backend.image,
    params.command,
    ...params.commandArgs,
  ];
}

function containerNetworkArgs(networkPolicy: ExecutionNetworkPolicy): string[] {
  if (
    networkPolicy.kind === "provider-egress" &&
    networkPolicy.enforcementMode === "docker-internal-proxy"
  ) {
    return ["--network", networkPolicy.networkName];
  }
  return ["--network", "none"];
}

function bindMountArg(source: string, readonly: boolean): string {
  return `type=bind,source=${source},target=${source}${readonly ? ",readonly" : ""}`;
}

function pathIsInsideOrEqual(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function containerMountArgs(params: {
  workingDir: string;
  replayRecordingsRoot?: string;
}): string[] {
  const mounts = [bindMountArg(params.workingDir, false)];
  if (
    params.replayRecordingsRoot !== undefined &&
    !pathIsInsideOrEqual(params.workingDir, params.replayRecordingsRoot)
  ) {
    mounts.push(bindMountArg(params.replayRecordingsRoot, true));
  }
  return mounts.flatMap((mount) => ["--mount", mount]);
}
