import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildRequiredInheritedSubprocessEnv } from "#core/modules/subprocess-env.js";
import type { TaskProbe, TaskProbeResult } from "./task-probe.js";
import {
  resolveTaskProbeSandbox,
  type TaskProbeSandbox,
} from "./task-probe-sandbox.js";

const MAX_PROBE_OUTPUT_CHARS = 20_000;
const SUPERVISOR_MAX_BUFFER = 256 * 1024;

function superviseTaskProbeProcess(): void {
  const { spawn } = require("node:child_process") as typeof import("node:child_process");
  const [timeoutRaw, outputLimitRaw, command, ...args] =
    process.argv.slice(1);
  const timeoutMs = Number(timeoutRaw);
  const outputLimit = Number(outputLimitRaw);
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isSafeInteger(outputLimit) ||
    outputLimit <= 0 ||
    !command
  ) {
    process.stderr.write("Invalid Runtime Probe supervisor arguments.\n");
    process.exit(125);
  }

  let output = "";
  let omittedChars = 0;
  let finished = false;
  let timedOut = false;
  let exitCode = 1;
  let timeoutTimer: NodeJS.Timeout | undefined;
  let cleanupTimer: NodeJS.Timeout | undefined;

  function appendOutput(value: string): void {
    output += value;
    if (output.length > outputLimit) {
      const excess = output.length - outputLimit;
      omittedChars += excess;
      output = output.slice(excess);
    }
  }

  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.stdout === null || child.stderr === null) {
    process.stderr.write("Runtime Probe supervisor did not receive output pipes.\n");
    process.exit(125);
  }
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", appendOutput);
  child.stderr.on("data", appendOutput);

  function terminateProcessGroup(): void {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      if (code !== "ESRCH") {
        appendOutput(
          `\nRuntime Probe process-group cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        child.kill("SIGKILL");
      }
    }
  }

  function finish(code: number): void {
    if (finished) return;
    finished = true;
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    if (cleanupTimer !== undefined) clearTimeout(cleanupTimer);
    terminateProcessGroup();
    const rendered = omittedChars > 0
      ? `[... ${omittedChars} chars truncated — showing tail ...]\n${output}`
      : output;
    if (rendered.length === 0) process.exit(code);
    process.stdout.write(rendered, () => process.exit(code));
  }

  child.once("error", (error) => {
    appendOutput(`Runtime Probe launch failed: ${error.message}\n`);
  });
  child.once("exit", (code, signal) => {
    if (!timedOut) {
      exitCode = typeof code === "number" ? code : 1;
      if (signal !== null) {
        appendOutput(`\nRuntime Probe sandbox terminated by ${signal}.\n`);
      }
    }
    terminateProcessGroup();
  });
  child.once("close", () => finish(timedOut ? 124 : exitCode));

  timeoutTimer = setTimeout(() => {
    timedOut = true;
    appendOutput(`\nRuntime Probe timed out after ${timeoutMs} ms.\n`);
    terminateProcessGroup();
    cleanupTimer = setTimeout(() => finish(124), 1_000);
  }, timeoutMs);
}

const TASK_PROBE_PROCESS_SUPERVISOR = `(${superviseTaskProbeProcess.toString()})();`;

export function runTaskProbe(
  probe: TaskProbe,
  projectDir: string,
): TaskProbeResult {
  return runTaskProbeInSandbox(
    probe,
    projectDir,
    resolveTaskProbeSandbox(projectDir, probe.timeoutMs),
  );
}

function runTaskProbeInSandbox(
  probe: TaskProbe,
  projectDir: string,
  sandbox: TaskProbeSandbox,
): TaskProbeResult {
  if (sandbox.status === "unavailable") {
    return {
      verdict: "fail",
      exitCode: -1,
      durationMs: 0,
      output: `Runtime Probe not executed: ${sandbox.reason}`,
      probe,
      execution: "not-executed",
      isolation: sandbox,
    };
  }
  const runtimeHome = mkdtempSync(join(projectDir, ".kota-runtime-probe-"));
  const start = Date.now();
  try {
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        TASK_PROBE_PROCESS_SUPERVISOR,
        String(probe.timeoutMs),
        String(MAX_PROBE_OUTPUT_CHARS),
        sandbox.command,
        ...sandbox.prefixArgs,
        sandbox.probeExecutable,
        ...probe.args,
      ],
      {
        cwd: projectDir,
        env: buildTaskProbeEnv(runtimeHome),
        encoding: "utf-8",
        maxBuffer: SUPERVISOR_MAX_BUFFER,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const durationMs = Date.now() - start;
    const combined = [
      result.stdout ?? "",
      result.stderr ?? "",
      result.error?.message ?? "",
    ]
      .filter((part) => part.length > 0)
      .join("\n");
    const output = truncateTail(combined, MAX_PROBE_OUTPUT_CHARS);
    const exitCode = result.status ?? -1;
    return {
      verdict: exitCode === 0 ? "pass" : "fail",
      exitCode,
      durationMs,
      output,
      probe,
      execution: "os-contained-command",
      isolation: {
        status: "enforced",
        kind: sandbox.kind,
        processBoundary: sandbox.processBoundary,
        evidence: sandbox.evidence,
      },
    };
  } finally {
    rmSync(runtimeHome, { recursive: true, force: true });
  }
}

function buildTaskProbeEnv(runtimeHome: string): NodeJS.ProcessEnv {
  return {
    ...buildRequiredInheritedSubprocessEnv(),
    HOME: runtimeHome,
    TMPDIR: runtimeHome,
    NO_COLOR: "1",
    KOTA_RUNTIME_PROBE: "1",
  };
}

function truncateTail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `[... ${text.length - limit} chars truncated — showing tail ...]\n${text.slice(-limit)}`;
}
