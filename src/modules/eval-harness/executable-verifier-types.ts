import type { ExecutionProfilePreflightResult } from "./fixture-run.js";
import type { IsolatedContainerProcessResult } from "./isolated-container-process.js";
import type { SubprocessIsolationBackend } from "./subprocess-executor-types.js";

const CONTAINER_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const CLI_ENV_KEYS = [
  "CONTAINER_HOST",
  "DOCKER_CERT_PATH",
  "DOCKER_CONTEXT",
  "DOCKER_HOST",
  "DOCKER_TLS_VERIFY",
  "HOME",
  "PATH",
  "TMPDIR",
  "XDG_RUNTIME_DIR",
] as const;

export type AvailableExecutableVerifierSandbox = {
  kind: "oci-container";
  command: string;
  image: string;
  cliEnv: NodeJS.ProcessEnv;
  evidence: string;
};

export type ExecutableVerifierSandbox =
  | AvailableExecutableVerifierSandbox
  | {
      kind: "unavailable";
      evidence: string;
      issue: string;
    };

export type ExecutableVerifierContext = {
  sandbox: ExecutableVerifierSandbox;
  executionProfile: ExecutionProfilePreflightResult;
  trustedVerifierRoot: string;
};

export type ExecutableVerifierExecution =
  | {
      started: true;
      isolation: AvailableExecutableVerifierSandbox;
      result: IsolatedContainerProcessResult;
    }
  | { started: false; issue: string };

export type ExecutableVerifier = (params: {
  workingDir: string;
  command: string;
  timeoutMs: number;
  maxBuffer: number;
}) => Promise<ExecutableVerifierExecution>;

function minimalContainerCliEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of CLI_ENV_KEYS) {
    const value = baseEnv[key];
    if (value !== undefined) env[key] = value;
  }
  env.PATH ??= CONTAINER_PATH;
  return env;
}

export function resolveExecutableVerifierSandbox(
  backend: SubprocessIsolationBackend,
  cliEnv: NodeJS.ProcessEnv = minimalContainerCliEnv(),
): ExecutableVerifierSandbox {
  if (backend.kind !== "container") {
    return {
      kind: "unavailable",
      evidence: "executable verifier isolation unavailable",
      issue:
        "executable scoring requires a verified isolated verifier; configure --isolation container",
    };
  }
  return {
    kind: "oci-container",
    command: backend.executable,
    image: backend.image,
    cliEnv,
    evidence:
      "disposable offline OCI verifier with read-only trusted scorer mounts and hard CPU, memory, PID, descriptor, output, and duration limits",
  };
}
