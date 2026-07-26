import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const CONTAINER_ID_PATTERN = /^[a-f0-9]{12,64}$/i;
const CONTAINER_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export type IsolatedContainerProcessResult = {
  error?: Error;
  signal: NodeJS.Signals | null;
  status: number | null;
  stderr: string;
  stdout: string;
};

export type IsolatedContainerCleanupResult = {
  error?: Error;
  signal: NodeJS.Signals | null;
  status: number | null;
};

function processError(message: string, code: string): Error {
  const error = new Error(message);
  error.name = code;
  return error;
}

export function forceRemoveContainer(
  command: string,
  cidFile: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  let containerId: string;
  try {
    containerId = readFileSync(cidFile, "utf8").trim();
  } catch {
    return Promise.resolve();
  }
  if (!CONTAINER_ID_PATTERN.test(containerId)) return Promise.resolve();
  return forceRemoveContainerReference(command, containerId, env).then(() => {});
}

export function forceRemoveContainerReference(
  command: string,
  reference: string,
  env: NodeJS.ProcessEnv,
): Promise<IsolatedContainerCleanupResult> {
  if (!CONTAINER_REFERENCE_PATTERN.test(reference)) {
    return Promise.resolve({
      error: new Error("invalid container cleanup reference"),
      signal: null,
      status: null,
    });
  }
  return new Promise((resolve) => {
    const child = spawn(command, ["rm", "--force", reference], {
      env,
      stdio: ["ignore", "ignore", "ignore"],
    });
    let cleanupError: Error | undefined;
    const timeout = setTimeout(() => {
      cleanupError = processError(
        "container cleanup exceeded 5000ms timeout",
        "ETIMEDOUT",
      );
      child.kill("SIGKILL");
    }, 5_000);
    child.once("error", (error) => {
      cleanupError ??= error;
    });
    child.once("close", (status, signal) => {
      clearTimeout(timeout);
      resolve({
        ...(cleanupError !== undefined && { error: cleanupError }),
        signal,
        status,
      });
    });
  });
}

export function runIsolatedContainerProcess(
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    label: string;
    maxBuffer: number;
    timeout: number;
  },
): Promise<IsolatedContainerProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let executionError: Error | undefined;

    const capture = (
      target: Buffer[],
      chunk: Buffer,
      stream: "stdout" | "stderr",
    ) => {
      const currentBytes = stream === "stdout" ? stdoutBytes : stderrBytes;
      if (currentBytes + chunk.byteLength <= options.maxBuffer) {
        target.push(chunk);
        if (stream === "stdout") stdoutBytes += chunk.byteLength;
        else stderrBytes += chunk.byteLength;
        return;
      }
      executionError ??= processError(
        `${stream} exceeded ${options.maxBuffer} bytes`,
        "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      );
      child.kill("SIGKILL");
    };

    child.stdout.on("data", (chunk: Buffer) => capture(stdout, chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => capture(stderr, chunk, "stderr"));
    child.once("error", (error) => {
      executionError ??= error;
    });
    const timeout = setTimeout(() => {
      executionError ??= processError(
        `${options.label} exceeded ${options.timeout}ms timeout`,
        "ETIMEDOUT",
      );
      child.kill("SIGKILL");
    }, options.timeout);
    child.once("close", (status, signal) => {
      clearTimeout(timeout);
      resolve({
        ...(executionError !== undefined && { error: executionError }),
        status,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}
