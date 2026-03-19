import { type ChildProcess, spawn } from "node:child_process";
import type { ToolResult } from "./index.js";

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

const STALE_PROCESS_MS = 10 * 60 * 1000;

function purgeStale(): void {
  const now = Date.now();
  for (const [id, mp] of processes) {
    if (mp.exited && mp.exitedAt && now - mp.exitedAt > STALE_PROCESS_MS) {
      processes.delete(id);
    }
  }
}

export async function startProcess(command: string): Promise<ToolResult> {
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
  const proc = spawn("sh", ["-c", command], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: false,
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
  };

  proc.stdout?.on("data", (chunk: Buffer) => {
    mp.stdoutPartial = processChunk(mp, chunk.toString(), mp.stdoutPartial, "");
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    mp.stderrPartial = processChunk(mp, chunk.toString(), mp.stderrPartial, "[stderr] ");
  });

  proc.on("close", (code) => {
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
  });

  proc.on("error", (err) => {
    mp.exited = true;
    mp.exitedAt = Date.now();
    mp.exitCode = -1;
    appendLine(mp, `[process error: ${err.message}]`);
  });

  proc.stdin?.end();
  processes.set(id, mp);

  const dim = process.stderr.isTTY ? "\x1b[2m" : "";
  const reset = process.stderr.isTTY ? "\x1b[0m" : "";
  process.stderr.write(`${dim}[bg] $ ${command} → ${id}${reset}\n`);

  await new Promise((resolve) => setTimeout(resolve, INITIAL_OUTPUT_WAIT_MS));

  const initial = mp.outputBuffer.slice(-10).join("\n");
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
  const output = mp.outputBuffer.slice(-n).join("\n");
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
    const delivered = mp.proc.kill(signal);
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
    const lastLine = mp.outputBuffer.length > 0
      ? mp.outputBuffer[mp.outputBuffer.length - 1]
      : "(no output)";
    const truncLast = lastLine.length > 80 ? `${lastLine.slice(0, 77)}...` : lastLine;
    lines.push(`${mp.id} [${status}] ${mp.command}\n  last: ${truncLast}`);
  }

  return { content: lines.join("\n\n") };
}

export function cleanupProcesses(): void {
  for (const mp of processes.values()) {
    if (!mp.exited && !mp.killing) {
      mp.killing = true;
      try { mp.proc.kill("SIGTERM"); } catch { /* already dead */ }
      const timer = setTimeout(() => {
        if (!mp.exited) {
          try { mp.proc.kill("SIGKILL"); } catch { /* already dead */ }
        }
      }, 2000);
      timer.unref();
    }
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
