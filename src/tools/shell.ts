import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import { enrichWithSourceContext } from "../error-context.js";
import type { ToolResult } from "./index.js";
import { smartErrorTruncate } from "./shell-diagnostics.js";

export const shellTool: Anthropic.Tool = {
  name: "shell",
  description:
    "Execute a shell command and return its output. " +
    "Use for running builds, tests, git commands, installing packages, etc. " +
    "Commands run in the working directory. Timeout: 120s by default.",
  input_schema: {
    type: "object" as const,
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute",
      },
      timeout_ms: {
        type: "number",
        description: "Timeout in milliseconds (default: 120000)",
      },
      cwd: {
        type: "string",
        description:
          "Working directory for the command (default: current directory). " +
          "Cleaner than 'cd path && cmd' — gives a clear error if the directory doesn't exist.",
      },
      stream_output: {
        type: "boolean",
        description:
          "Whether to stream the command and its live output to stderr while it runs. Default: true.",
      },
    },
    required: ["command"],
  },
};

/** Truncate collected output to save tokens in the tool result. */
function truncateOutput(text: string): string {
  if (text.length <= 20_000) return text;
  return (
    text.slice(0, 10_000) +
    `\n\n... [truncated — output was ${text.length} chars] ...\n\n` +
    text.slice(-5_000)
  );
}

export async function runShell(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const command = input.command as string;
  const timeout = (input.timeout_ms as number) || 120_000;
  const streamOutput = input.stream_output !== false;

  if (!command) {
    return { content: "Error: command is required", is_error: true };
  }

  const cwd = (input.cwd as string) || process.cwd();
  if (input.cwd && !existsSync(cwd)) {
    return { content: `Error: working directory not found: ${cwd}`, is_error: true };
  }

  return new Promise((resolve) => {
    const chunks: string[] = [];
    let killed = false;

    // Show the command being run (dimmed)
    const dim = process.stderr.isTTY ? "\x1b[2m" : "";
    const reset = process.stderr.isTTY ? "\x1b[0m" : "";
    if (streamOutput) {
      process.stderr.write(`${dim}$ ${command}${reset}\n`);
    }

    const proc = spawn("sh", ["-c", command], {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGTERM");
      // Force kill after 5s if SIGTERM doesn't work
      setTimeout(() => proc.kill("SIGKILL"), 5_000);
    }, timeout);

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      chunks.push(text);
      if (streamOutput) process.stderr.write(text);
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      chunks.push(text);
      if (streamOutput) process.stderr.write(text);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      const output = chunks.join("").trim();

      if (killed) {
        resolve({
          content: output
            ? `${truncateOutput(output)}\n\n(killed: timeout after ${timeout}ms)`
            : `Command timed out after ${timeout}ms`,
          is_error: true,
        });
        return;
      }

      if (code !== 0 && code !== null) {
        const truncated = smartErrorTruncate(output || `Command failed with exit code ${code}`);
        resolve({
          content: enrichWithSourceContext(truncated, input.cwd ? cwd : undefined),
          is_error: true,
        });
        return;
      }

      if (!output) {
        resolve({ content: "(no output)" });
        return;
      }

      resolve({ content: truncateOutput(output) });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ content: `Command error: ${err.message}`, is_error: true });
    });

    // Close stdin immediately — commands don't read from it
    proc.stdin.end();
  });
}
export const registration = {
	tool: shellTool,
	runner: runShell,
	risk: "moderate" as const,
	kind: "action" as const,
};
