import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AvailableScientificClaimAnalyzerSandbox,
  type PreparedAnalyzerFilesystem,
  prepareAnalyzerFilesystem,
  type ScientificClaimAnalyzerInvocation,
  scientificClaimAnalyzerContainerArgs,
} from "./scientific-claim-analyzer-container.js";
import type { SubprocessIsolationBackend } from "./subprocess-executor-types.js";

const CONTAINER_ID_PATTERN = /^[a-f0-9]{12,64}$/i;

export type { ScientificClaimAnalyzerInvocation } from "./scientific-claim-analyzer-container.js";

export type ScientificClaimAnalyzerSandbox =
  | AvailableScientificClaimAnalyzerSandbox
  | {
      kind: "unavailable";
      evidence: string;
      issue: string;
    };

export type ScientificClaimAnalyzerExecution =
  | {
      started: true;
      isolation: AvailableScientificClaimAnalyzerSandbox;
      result: ScientificClaimAnalyzerProcessResult;
    }
  | {
      started: false;
      issue: string;
    };

export type ScientificClaimAnalyzerProcessResult = {
  error?: Error;
  signal: NodeJS.Signals | null;
  status: number | null;
  stderr: string;
  stdout: string;
};

function forceRemoveContainer(command: string, cidFile: string): Promise<void> {
  let containerId: string;
  try {
    containerId = readFileSync(cidFile, "utf8").trim();
  } catch {
    return Promise.resolve();
  }
  if (!CONTAINER_ID_PATTERN.test(containerId)) return Promise.resolve();
  return new Promise((resolve) => {
    const child = spawn(command, ["rm", "--force", containerId], {
      env: { ...process.env },
      stdio: ["ignore", "ignore", "ignore"],
    });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
    const finish = () => {
      clearTimeout(timeout);
      resolve();
    };
    child.once("close", finish);
    child.once("error", finish);
  });
}

function analyzerProcessError(message: string, code: string): Error {
  const error = new Error(message);
  error.name = code;
  return error;
}

function runAnalyzerContainer(
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    maxBuffer: number;
    timeout: number;
  },
): Promise<ScientificClaimAnalyzerProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let processError: Error | undefined;

    const capture = (target: Buffer[], chunk: Buffer, stream: "stdout" | "stderr") => {
      const currentBytes = stream === "stdout" ? stdoutBytes : stderrBytes;
      if (currentBytes + chunk.byteLength <= options.maxBuffer) {
        target.push(chunk);
        if (stream === "stdout") stdoutBytes += chunk.byteLength;
        else stderrBytes += chunk.byteLength;
        return;
      }
      processError ??= analyzerProcessError(
        `${stream} exceeded ${options.maxBuffer} bytes`,
        "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      );
      child.kill("SIGKILL");
    };

    child.stdout.on("data", (chunk: Buffer) => capture(stdout, chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => capture(stderr, chunk, "stderr"));
    child.once("error", (error) => {
      processError ??= error;
    });
    const timeout = setTimeout(() => {
      processError ??= analyzerProcessError(
        `analyzer container exceeded ${options.timeout}ms timeout`,
        "ETIMEDOUT",
      );
      child.kill("SIGKILL");
    }, options.timeout);
    child.once("close", (status, signal) => {
      clearTimeout(timeout);
      resolve({
        ...(processError !== undefined && { error: processError }),
        status,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

/** Agent-produced analyzers require the same configured OCI backend as gated evals. */
export function resolveScientificClaimAnalyzerSandbox(
  backend: SubprocessIsolationBackend,
): ScientificClaimAnalyzerSandbox {
  if (backend.kind !== "container") {
    return {
      kind: "unavailable",
      evidence: "analyzer resource isolation unavailable",
      issue:
        "scientific-claim analyzer verification requires --isolation container; " +
        "refusing to execute agent-produced JavaScript in the evaluator host process",
    };
  }
  return {
    kind: "oci-container",
    command: backend.executable,
    image: backend.image,
    evidence:
      "disposable offline OCI container with hard memory, CPU, PID, and file-descriptor limits",
  };
}

export async function spawnScientificClaimAnalyzer(
  isolation: ScientificClaimAnalyzerSandbox,
  invocation: ScientificClaimAnalyzerInvocation,
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    maxBuffer: number;
    readOnlyPaths: readonly string[];
    timeout: number;
    writablePaths: readonly string[];
  },
): Promise<ScientificClaimAnalyzerExecution> {
  if (isolation.kind === "unavailable") {
    return { started: false, issue: isolation.issue };
  }
  let filesystem: PreparedAnalyzerFilesystem;
  try {
    filesystem = prepareAnalyzerFilesystem(options);
  } catch (error) {
    return {
      started: false,
      issue: error instanceof Error ? error.message : String(error),
    };
  }

  const controlDir = mkdtempSync(join(tmpdir(), "kota-analyzer-container-"));
  const cidFile = join(controlDir, "cid");
  try {
    const result = await runAnalyzerContainer(
      isolation.command,
      scientificClaimAnalyzerContainerArgs({
        isolation,
        invocation,
        filesystem,
        env: options.env,
        cidFile,
      }),
      {
        cwd: filesystem.workingDir,
        maxBuffer: options.maxBuffer,
        timeout: options.timeout,
      },
    );
    if (result.error !== undefined || result.status !== 0) {
      await forceRemoveContainer(isolation.command, cidFile);
    }
    return { started: true, isolation, result };
  } finally {
    rmSync(controlDir, { recursive: true, force: true });
  }
}
