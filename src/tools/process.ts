import type Anthropic from "@anthropic-ai/sdk";
import { spawn, type ChildProcess } from "node:child_process";
import type { ToolResult } from "./index.js";
import { isDangerous, confirmExecution } from "../confirm.js";

export const processTool: Anthropic.Tool = {
  name: "process",
  description:
    "Manage background processes (start/output/signal/list). " +
    "Use for dev servers, watchers, and long-running commands that should run while you do other work.",
  input_schema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["start", "output", "signal", "list"],
        description: "The action to perform",
      },
      command: {
        type: "string",
        description: "Shell command to run (for 'start' action)",
      },
      process_id: {
        type: "string",
        description: "Process ID (for 'output' and 'signal' actions)",
      },
      signal: {
        type: "string",
        enum: ["SIGTERM", "SIGINT", "SIGKILL"],
        description: "Signal to send (for 'signal' action, default: SIGTERM)",
      },
      lines: {
        type: "number",
        description: "Number of recent output lines to return (for 'output', default: 50)",
      },
    },
    required: ["action"],
  },
};

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
  exitCode: number | null;
  exited: boolean;
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

function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return (
    text.slice(0, 10_000) +
    `\n\n... [truncated — output was ${text.length} chars] ...\n\n` +
    text.slice(-5_000)
  );
}

async function startProcess(command: string): Promise<ToolResult> {
  if (!command) {
    return { content: "Error: command is required for 'start' action", is_error: true };
  }

  if (isDangerous(command)) {
    const confirmed = await confirmExecution(command);
    if (!confirmed) {
      return { content: "Command blocked: user declined destructive operation", is_error: true };
    }
  }

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
    exitCode: null,
    exited: false,
  };

  proc.stdout?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line) appendLine(mp, line);
    }
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line) appendLine(mp, `[stderr] ${line}`);
    }
  });

  proc.on("close", (code) => {
    mp.exited = true;
    mp.exitCode = code;
    appendLine(mp, `[process exited with code ${code}]`);
  });

  proc.on("error", (err) => {
    mp.exited = true;
    mp.exitCode = -1;
    appendLine(mp, `[process error: ${err.message}]`);
  });

  proc.stdin?.end();
  processes.set(id, mp);

  // Show dimmed command on stderr like shell tool
  const dim = process.stderr.isTTY ? "\x1b[2m" : "";
  const reset = process.stderr.isTTY ? "\x1b[0m" : "";
  process.stderr.write(`${dim}[bg] $ ${command} → ${id}${reset}\n`);

  // Wait briefly for initial output (e.g., server startup messages)
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

function getOutput(processId: string, lines: number): ToolResult {
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

function sendSignal(processId: string, sig: string): ToolResult {
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
    mp.proc.kill(signal);
    return { content: `Sent ${signal} to process ${processId} (PID ${mp.proc.pid}).` };
  } catch (err) {
    return { content: `Error sending ${signal}: ${(err as Error).message}`, is_error: true };
  }
}

function listProcesses(): ToolResult {
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
    const truncLast = lastLine.length > 80 ? lastLine.slice(0, 77) + "..." : lastLine;
    lines.push(`${mp.id} [${status}] ${mp.command}\n  last: ${truncLast}`);
  }

  return { content: lines.join("\n\n") };
}

export async function runProcess(input: Record<string, unknown>): Promise<ToolResult> {
  const action = input.action as string;

  switch (action) {
    case "start":
      return startProcess(input.command as string);
    case "output":
      return getOutput(
        input.process_id as string,
        (input.lines as number) || 50,
      );
    case "signal":
      return sendSignal(
        input.process_id as string,
        (input.signal as string) || "SIGTERM",
      );
    case "list":
      return listProcesses();
    default:
      return { content: `Error: unknown action "${action}". Use: start, output, signal, list`, is_error: true };
  }
}

/** Terminate all managed processes. Called on session close. */
export function cleanupProcesses(): void {
  for (const mp of processes.values()) {
    if (!mp.exited) {
      try { mp.proc.kill("SIGTERM"); } catch { /* already dead */ }
      // Force kill after 2s if still alive
      setTimeout(() => {
        if (!mp.exited) {
          try { mp.proc.kill("SIGKILL"); } catch { /* already dead */ }
        }
      }, 2000);
    }
  }
}

/** Get count of active (non-exited) processes. For testing. */
export function getActiveProcessCount(): number {
  return [...processes.values()].filter((p) => !p.exited).length;
}

/** Clear all process records. For testing. */
export function clearProcesses(): void {
  cleanupProcesses();
  processes.clear();
  nextId = 1;
}
