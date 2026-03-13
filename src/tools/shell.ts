import type Anthropic from "@anthropic-ai/sdk";
import { execSync } from "node:child_process";
import type { ToolResult } from "./index.js";

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
    },
    required: ["command"],
  },
};

export async function runShell(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const command = input.command as string;
  const timeout = (input.timeout_ms as number) || 120_000;

  if (!command) {
    return { content: "Error: command is required", is_error: true };
  }

  try {
    const output = execSync(command, {
      timeout,
      encoding: "utf-8",
      maxBuffer: 1024 * 1024, // 1MB
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
    });
    const trimmed = output.trim();
    if (!trimmed) return { content: "(no output)" };

    // Truncate if too long to save tokens
    if (trimmed.length > 20_000) {
      return {
        content:
          trimmed.slice(0, 10_000) +
          "\n\n... [truncated — output was " +
          trimmed.length +
          " chars] ...\n\n" +
          trimmed.slice(-5_000),
      };
    }
    return { content: trimmed };
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const stderr = (e.stderr || "").trim();
    const stdout = (e.stdout || "").trim();
    const parts = [stderr, stdout].filter(Boolean).join("\n");
    return {
      content: parts || e.message || "Command failed",
      is_error: true,
    };
  }
}
