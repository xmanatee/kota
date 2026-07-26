import { randomUUID } from "node:crypto";
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import type {
  AvailableExecutableVerifierSandbox,
  ExecutableVerifierContext,
  ExecutableVerifierExecution,
} from "./executable-verifier-types.js";
import type { ExecutionProfilePreflightResult } from "./fixture-run.js";
import {
  forceRemoveContainerReference,
  type IsolatedContainerProcessResult,
  runIsolatedContainerProcess,
} from "./isolated-container-process.js";
import { containerExecutionProfileCanRun } from "./subprocess-executor-preflight.js";

export type {
  AvailableExecutableVerifierSandbox,
  ExecutableVerifier,
  ExecutableVerifierContext,
  ExecutableVerifierExecution,
  ExecutableVerifierSandbox,
} from "./executable-verifier-types.js";
export { resolveExecutableVerifierSandbox } from "./executable-verifier-types.js";

const VERIFIER_PID_LIMIT = 64;
const VERIFIER_FILE_DESCRIPTOR_LIMIT = 128;
const VERIFIER_TMPFS_LIMIT_MB = 64;
const CONTAINER_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
function pathIsInsideOrEqual(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function collectTrustedScorerFiles(
  trustedVerifierRoot: string,
): { root: string; relativePaths: string[] } {
  const root = realpathSync(trustedVerifierRoot);
  const scriptsDir = join(root, "scripts");
  const scriptsEntry = lstatSync(scriptsDir, { throwIfNoEntry: false });
  if (scriptsEntry === undefined) return { root, relativePaths: [] };
  if (!scriptsEntry.isDirectory() || scriptsEntry.isSymbolicLink()) {
    throw new Error("trusted verifier scripts path must be a real directory");
  }

  const relativePaths: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`trusted verifier contains a non-regular entry: ${path}`);
      }
      const resolved = realpathSync(path);
      if (!pathIsInsideOrEqual(root, resolved)) {
        throw new Error(`trusted verifier file escapes its root: ${path}`);
      }
      relativePaths.push(relative(root, resolved));
    }
  };
  visit(scriptsDir);
  return { root, relativePaths: relativePaths.sort() };
}

function prepareTrustedScorerMounts(params: {
  trustedVerifierRoot: string;
  workingDir: string;
}): { source: string; target: string }[] {
  const workingDir = realpathSync(params.workingDir);
  const trusted = collectTrustedScorerFiles(params.trustedVerifierRoot);
  return trusted.relativePaths.map((relativePath) => {
    const source = join(trusted.root, relativePath);
    const target = join(workingDir, relativePath);
    const targetEntry = lstatSync(target, { throwIfNoEntry: false });
    if (
      targetEntry === undefined ||
      !targetEntry.isFile() ||
      targetEntry.isSymbolicLink()
    ) {
      throw new Error(
        `candidate verifier target must remain a regular file: ${relativePath}`,
      );
    }
    const resolvedTarget = realpathSync(target);
    if (!pathIsInsideOrEqual(workingDir, resolvedTarget)) {
      throw new Error(`candidate verifier target escapes its workspace: ${relativePath}`);
    }
    return { source, target: resolvedTarget };
  });
}

function bindMount(source: string, target: string, readonly: boolean): string {
  if (source.includes(",") || target.includes(",")) {
    throw new Error("verifier container mount paths cannot contain commas");
  }
  return `type=bind,source=${source},target=${target}${readonly ? ",readonly" : ""}`;
}

function verifierContainerArgs(params: {
  sandbox: AvailableExecutableVerifierSandbox;
  executionProfile: ExecutionProfilePreflightResult;
  workingDir: string;
  trustedMounts: readonly { source: string; target: string }[];
  command: string;
  containerName: string;
  timeoutMs: number;
}): string[] {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  const gid = typeof process.getgid === "function" ? process.getgid() : null;
  if (uid === null || gid === null) {
    throw new Error("executable verifier containers require a POSIX uid and gid");
  }
  const profile = params.executionProfile.observedOrEnforcedProfile;
  const memoryLimit = `${profile.memoryKillThresholdMB}m`;
  const cpuTimeLimitSeconds = Math.max(1, Math.ceil(params.timeoutMs / 1_000));
  return [
    "run",
    "--init",
    "--pull",
    "never",
    "--name",
    params.containerName,
    "--network",
    "none",
    "--ipc",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--user",
    `${uid}:${gid}`,
    "--cpus",
    String(profile.cpuKillThresholdCores),
    "--memory-reservation",
    `${profile.memoryAllocationMB}m`,
    "--memory",
    memoryLimit,
    "--memory-swap",
    memoryLimit,
    "--pids-limit",
    String(VERIFIER_PID_LIMIT),
    "--ulimit",
    `cpu=${cpuTimeLimitSeconds}:${cpuTimeLimitSeconds}`,
    "--ulimit",
    `nofile=${VERIFIER_FILE_DESCRIPTOR_LIMIT}:${VERIFIER_FILE_DESCRIPTOR_LIMIT}`,
    "--tmpfs",
    `/tmp:rw,noexec,nosuid,nodev,size=${VERIFIER_TMPFS_LIMIT_MB}m`,
    "--mount",
    bindMount(params.workingDir, params.workingDir, false),
    ...params.trustedMounts.flatMap((mount) => [
      "--mount",
      bindMount(mount.source, mount.target, true),
    ]),
    "--workdir",
    params.workingDir,
    "--env",
    "CI=1",
    "--env",
    "HOME=/tmp",
    "--env",
    "LANG=C",
    "--env",
    "LC_ALL=C",
    "--env",
    "NO_COLOR=1",
    "--env",
    `PATH=${CONTAINER_PATH}`,
    "--env",
    "TMPDIR=/tmp",
    "--entrypoint",
    "/bin/sh",
    params.sandbox.image,
    "-c",
    params.command,
  ];
}

export async function executeIsolatedVerifier(params: {
  context: ExecutableVerifierContext;
  workingDir: string;
  command: string;
  timeoutMs: number;
  maxBuffer: number;
}): Promise<ExecutableVerifierExecution> {
  if (params.context.sandbox.kind === "unavailable") {
    return { started: false, issue: params.context.sandbox.issue };
  }
  if (!containerExecutionProfileCanRun(params.context.executionProfile)) {
    return {
      started: false,
      issue:
        "executable scoring requires a verified isolated verifier execution profile; refusing host execution",
    };
  }

  let workingDir: string;
  let trustedMounts: { source: string; target: string }[];
  try {
    workingDir = realpathSync(params.workingDir);
    trustedMounts = prepareTrustedScorerMounts({
      trustedVerifierRoot: params.context.trustedVerifierRoot,
      workingDir,
    });
  } catch (error) {
    return {
      started: false,
      issue: error instanceof Error ? error.message : String(error),
    };
  }

  const containerName = `kota-verifier-${randomUUID()}`;
  const sandbox = params.context.sandbox;
  let result: IsolatedContainerProcessResult;
  try {
    result = await runIsolatedContainerProcess(
      sandbox.command,
      verifierContainerArgs({
        sandbox,
        executionProfile: params.context.executionProfile,
        workingDir,
        trustedMounts,
        command: params.command,
        containerName,
        timeoutMs: params.timeoutMs,
      }),
      {
        cwd: workingDir,
        env: sandbox.cliEnv,
        label: "executable verifier container",
        maxBuffer: params.maxBuffer,
        timeout: params.timeoutMs,
      },
    );
  } catch (error) {
    return {
      started: false,
      issue: error instanceof Error ? error.message : String(error),
    };
  }
  const cleanup = await forceRemoveContainerReference(
    sandbox.command,
    containerName,
    sandbox.cliEnv,
  );
  if (cleanup.error !== undefined || cleanup.status !== 0) {
    return {
      started: false,
      issue:
        "executable verifier container cleanup could not be confirmed; refusing scoring result",
    };
  }
  return { started: true, isolation: sandbox, result };
}
