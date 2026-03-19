import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "./index.js";
import {
  cleanupProcesses,
  clearProcesses,
  getActiveProcessCount,
  getOutput,
  listProcesses,
  sendSignal,
  startProcess,
} from "./process-core.js";

export { cleanupProcesses, clearProcesses, getActiveProcessCount };

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

export const registration = {
  tool: processTool,
  runner: runProcess,
  risk: "moderate" as const,
  kind: "action" as const,
  group: "management",
};
