import { type ChildProcess, spawn } from "node:child_process";
import type { ToolRunnerContext } from "#core/tools/index.js";
import { registerSessionEnvironmentResource } from "#core/tools/session-environment.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { line, span } from "#modules/rendering/primitives.js";
import { printToStderr } from "#modules/rendering/transport.js";
import { buildExecutionEnv } from "./execution-env.js";
import { buildShellMachineAuthoritySandboxLaunch } from "./machine-authority-sandbox.js";
import * as processLifecycle from "./process-lifecycle.js";

const MAX_BUFFER_LINES = 500;
const MAX_PROCESSES = 5;
const INITIAL_OUTPUT_WAIT_MS = 500;
const MAX_OUTPUT_CHARS = 20_000;
type ManagedProcess = {
  id: string;
  command: string;
  proc: ChildProcess;
  outputBuffer: string[];
  startedAt: number;
  exitedAt: number | null;
  exitCode: number | null;
  exited: boolean;
  killing: boolean;
  stdoutPartial: string;
  stderrPartial: string;
  detachEnvironmentCleanup: (() => void) | null;
};

const processes = new Map<string, ManagedProcess>();
let nextId = 1;

function generateId(): string {
  return `p${nextId++}`;
}

function formatUptime(startedAt: number): string {
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m${elapsed % 60}s`;
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  return `${h}h${m}m`;
}

function appendLine(mp: ManagedProcess, line: string): void {
  mp.outputBuffer.push(line);
  if (mp.outputBuffer.length > MAX_BUFFER_LINES) {
    mp.outputBuffer.shift();
  }
}

function processChunk(
  mp: ManagedProcess,
  chunk: string,
  partial: string,
  prefix: string,
): string {
  const data = partial + chunk;
  const lines = data.split("\n");
  const newPartial = lines.pop()!;
  for (const line of lines) {
    appendLine(mp, prefix ? `${prefix}${line}` : line);
  }
  return newPartial;
}

function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return (
    text.slice(0, 10_000) +
    `\n\n... [truncated — output was ${text.length} chars] ...\n\n` +
    text.slice(-5_000)
  );
}

function displayLines(mp: ManagedProcess): string[] {
  const lines = [...mp.outputBuffer];
  if (mp.stdoutPartial) lines.push(mp.stdoutPartial);
  if (mp.stderrPartial) lines.push(`[stderr] ${mp.stderrPartial}`);
  return lines;
}

function createInitialActivityWaiter(): { mark: () => void; wait: (timeoutMs: number) => Promise<void> } {
  let resolved = false;
  let resolveActivity: () => void = () => {};
  const activity = new Promise<void>((resolve) => { resolveActivity = resolve; });
  const mark = () => {
    if (resolved) return;
    resolved = true;
    resolveActivity();
  };

  return {
    mark,
    wait: async (timeoutMs: number) => {
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
      await Promise.race([activity, timeout]);
      resolved = true;
    },
  };
}

const STALE_PROCESS_MS = 10 * 60 * 1000;

function purgeStale(): void {
  const now = Date.now();
  for (const [id, mp] of processes) {
    if (mp.exited && mp.exitedAt && now - mp.exitedAt > STALE_PROCESS_MS) {
      processes.delete(id);
    }
  }
}

export async function startProcess(command: string, context?: ToolRunnerContext): Promise<ToolResult> {
  if (!command || !command.trim()) {
    return { content: "Error: command is required for 'start' action", is_error: true };
  }

  purgeStale();

  const running = [...processes.values()].filter((p) => !p.exited);
  if (running.length >= MAX_PROCESSES) {
    const list = running.map((p) => `  ${p.id}: ${p.command}`).join("\n");
    return {
      content: `Error: max ${MAX_PROCESSES} concurrent processes. Running:\n${list}\nStop one first.`,
      is_error: true,
    };
  }

  const id = generateId();
  const cwd = context?.cwd ?? process.cwd();
  const launch = buildShellMachineAuthoritySandboxLaunch(command, cwd, context?.authorityConfigPath);
  if (!launch.ok) {
    return { content: `Error: ${launch.error}`, is_error: true };
  }
  const proc = spawn(launch.command, launch.args, {
    cwd,
    env: buildExecutionEnv(context),
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  const mp: ManagedProcess = {
    id,
    command,
    proc,
    outputBuffer: [],
    startedAt: Date.now(),
    exitedAt: null,
    exitCode: null,
    exited: false,
    killing: false,
    stdoutPartial: "",
    stderrPartial: "",
    detachEnvironmentCleanup: null,
  };
  mp.detachEnvironmentCleanup = registerSessionEnvironmentResource(
    context,
    () => processLifecycle.beginProcessTermination(mp),
  );
  const initialActivity = createInitialActivityWaiter();

  proc.stdout?.on("data", (chunk: Buffer) => {
    mp.stdoutPartial = processChunk(mp, chunk.toString(), mp.stdoutPartial, "");
    initialActivity.mark();
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    mp.stderrPartial = processChunk(mp, chunk.toString(), mp.stderrPartial, "[stderr] ");
    initialActivity.mark();
  });

  proc.on("close", (code) => {
    processLifecycle.detachEnvironmentCleanup(mp);
    if (mp.stdoutPartial) appendLine(mp, mp.stdoutPartial);
    if (mp.stderrPartial) appendLine(mp, `[stderr] ${mp.stderrPartial}`);
    mp.stdoutPartial = "";
    mp.stderrPartial = "";
    if (!mp.exited) {
      mp.exitCode = code;
    }
    mp.exited = true;
    mp.exitedAt = Date.now();
    appendLine(mp, `[process exited with code ${mp.exitCode}]`);
    initialActivity.mark();
  });

  proc.on("error", (err) => {
    processLifecycle.detachEnvironmentCleanup(mp);
    mp.exited = true;
    mp.exitedAt = Date.now();
    mp.exitCode = -1;
    appendLine(mp, `[process error: ${err.message}]`);
    initialActivity.mark();
  });

  proc.stdin?.end();
  processes.set(id, mp);

  printToStderr(line(span(`[bg] $ ${command} → ${id}`, "muted")));

  await initialActivity.wait(INITIAL_OUTPUT_WAIT_MS);

  const initial = truncateOutput(displayLines(mp).slice(-10).join("\n"));
  const status = mp.exited
    ? `exited (code ${mp.exitCode})`
    : "running";

  return {
    content:
      `Started background process ${id}\n` +
      `Command: ${command}\n` +
      `PID: ${proc.pid}\n` +
      `Status: ${status}\n` +
      (initial ? `\nInitial output:\n${initial}` : "\n(no output yet)"),
  };
}

export function getOutput(processId: string, lines: number): ToolResult {
  const mp = processes.get(processId);
  if (!mp) {
    const available = [...processes.keys()].join(", ") || "(none)";
    return { content: `Error: unknown process "${processId}". Available: ${available}`, is_error: true };
  }

  const n = Math.min(Math.max(lines, 1), MAX_BUFFER_LINES);
  const output = displayLines(mp).slice(-n).join("\n");
  const status = mp.exited
    ? `exited (code ${mp.exitCode})`
    : `running (${formatUptime(mp.startedAt)})`;

  return {
    content:
      `Process ${processId} [${status}]\n` +
      `Command: ${mp.command}\n` +
      `Buffer: ${mp.outputBuffer.length}/${MAX_BUFFER_LINES} lines\n\n` +
      (output ? truncateOutput(output) : "(no output)"),
  };
}

export function sendSignal(processId: string, sig: string): ToolResult {
  const mp = processes.get(processId);
  if (!mp) {
    const available = [...processes.keys()].join(", ") || "(none)";
    return { content: `Error: unknown process "${processId}". Available: ${available}`, is_error: true };
  }

  if (mp.exited) {
    return { content: `Process ${processId} already exited (code ${mp.exitCode}).` };
  }

  const signal = (sig || "SIGTERM") as NodeJS.Signals;
  try {
    const delivered = processLifecycle.deliverProcessSignal(mp, signal);
    if (!delivered) {
      return { content: `Process ${processId} is no longer running (signal not delivered).` };
    }
    return { content: `Sent ${signal} to process ${processId} (PID ${mp.proc.pid}).` };
  } catch (err) {
    return { content: `Error sending ${signal}: ${(err as Error).message}`, is_error: true };
  }
}

export function listProcesses(): ToolResult {
  if (processes.size === 0) {
    return { content: "No managed processes." };
  }

  const lines: string[] = [];
  for (const mp of processes.values()) {
    const status = mp.exited
      ? `exited (code ${mp.exitCode})`
      : `running (${formatUptime(mp.startedAt)})`;
    const outputLines = displayLines(mp);
    const lastLine = outputLines.length > 0
      ? outputLines[outputLines.length - 1]
      : "(no output)";
    const truncLast = lastLine.length > 80 ? `${lastLine.slice(0, 77)}...` : lastLine;
    lines.push(`${mp.id} [${status}] ${mp.command}\n  last: ${truncLast}`);
  }

  return { content: lines.join("\n\n") };
}

export function cleanupProcesses(): void {
  for (const mp of processes.values()) {
    processLifecycle.beginProcessTermination(mp);
  }
}

export function getActiveProcessCount(): number {
  return [...processes.values()].filter((p) => !p.exited).length;
}

export function clearProcesses(): void {
  cleanupProcesses();
  processes.clear();
  nextId = 1;
}
