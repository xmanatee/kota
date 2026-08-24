import { spawnSync } from "node:child_process";

export type ProcessGroupCommandInput = {
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  outputLimit: number;
};

export type ProcessGroupCommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

const PROCESS_GROUP_COMMAND_SUPERVISOR = String.raw`
const { spawn } = require("node:child_process");
const [timeoutRaw, outputLimitRaw, command, ...args] = process.argv.slice(1);
const timeoutMs = Number(timeoutRaw);
const outputLimit = Number(outputLimitRaw);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 ||
    !Number.isSafeInteger(outputLimit) || outputLimit <= 0 || !command) {
  process.stderr.write("Invalid process-group command arguments.\n");
  process.exit(125);
}

let stdout = "";
let stderr = "";
let finished = false;
let timedOut = false;
let exitCode = 1;
let timeoutTimer;
let cleanupTimer;

function appendTail(current, value) {
  const combined = current + value;
  return combined.length <= outputLimit
    ? combined
    : combined.slice(combined.length - outputLimit);
}

const child = spawn(command, args, {
  cwd: process.cwd(),
  env: process.env,
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
});
if (child.stdout === null || child.stderr === null) {
  process.stderr.write("Process-group command did not receive output pipes.\n");
  process.exit(125);
}
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (value) => {
  stdout = appendTail(stdout, value);
});
child.stderr.on("data", (value) => {
  stderr = appendTail(stderr, value);
});

function terminateProcessGroup() {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") {
      stderr = appendTail(stderr, "\nProcess-group cleanup failed: " + String(error) + "\n");
      child.kill("SIGKILL");
    }
  }
}

function finish(code) {
  if (finished) return;
  finished = true;
  if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
  if (cleanupTimer !== undefined) clearTimeout(cleanupTimer);
  terminateProcessGroup();
  process.exitCode = code;
  if (stdout.length > 0) process.stdout.write(stdout);
  if (stderr.length > 0) process.stderr.write(stderr);
}

child.once("error", (error) => {
  exitCode = 125;
  stderr = appendTail(stderr, "Command launch failed: " + error.message + "\n");
});
child.once("exit", (code, signal) => {
  if (!timedOut) {
    exitCode = typeof code === "number" ? code : 1;
    if (signal !== null) {
      stderr = appendTail(stderr, "\nCommand terminated by " + signal + ".\n");
    }
  }
  terminateProcessGroup();
});
child.once("close", () => finish(timedOut ? 124 : exitCode));

timeoutTimer = setTimeout(() => {
  timedOut = true;
  stderr = appendTail(stderr, "\nCommand timed out after " + timeoutMs + " ms.\n");
  terminateProcessGroup();
  cleanupTimer = setTimeout(() => finish(124), 1_000);
}, timeoutMs);
`;

export function runProcessGroupCommandSync(
  input: ProcessGroupCommandInput,
): ProcessGroupCommandResult {
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new Error("Process-group command timeout must be a positive integer");
  }
  if (!Number.isSafeInteger(input.outputLimit) || input.outputLimit <= 0) {
    throw new Error("Process-group command output limit must be a positive integer");
  }
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      PROCESS_GROUP_COMMAND_SUPERVISOR,
      String(input.timeoutMs),
      String(input.outputLimit),
      input.command,
      ...input.args,
    ],
    {
      cwd: input.cwd,
      env: input.env,
      encoding: "utf8",
      maxBuffer: input.outputLimit * 2 + 64 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stderr = [result.stderr ?? "", result.error?.message ?? ""]
    .filter(Boolean)
    .join("\n");
  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr,
    timedOut:
      result.status === 124 && /Command timed out after \d+ ms\./.test(stderr),
  };
}
