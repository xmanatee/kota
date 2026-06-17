import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import { printTerminalPrompt } from "#core/modules/terminal-renderer.js";
import { operatorSurfaceEffect } from "./effect.js";
import type { ToolResult } from "./index.js";

export const askUserTool: KotaTool = {
  name: "ask_user",
  description:
    "Ask the user a question and wait for their response. " +
    "Use when you need clarification, a decision, or information " +
    "only the user can provide. Do not overuse — only ask when " +
    "you genuinely cannot proceed without user input.",
  input_schema: {
    type: "object" as const,
    properties: {
      question: {
        type: "string",
        description: "The question to ask the user",
      },
    },
    required: ["question"],
  },
};

/** Override for testing — replaces the terminal prompt with a mock. */
let promptOverride: ((question: string) => Promise<string>) | null = null;

export function setPromptOverride(fn: ((question: string) => Promise<string>) | null): void {
  promptOverride = fn;
}

export async function runAskUser(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const question = input.question as string;
  if (!question) {
    return { content: "Error: question is required", is_error: true };
  }

  try {
    const answer = promptOverride
      ? await promptOverride(question)
      : await promptFromTerminal(question);
    if (!answer) {
      return { content: "(User provided no response — proceed with your best judgment.)" };
    }
    return { content: answer };
  } catch {
    return {
      content:
        "No interactive terminal available. " +
        "Proceed with your best judgment based on available context.",
    };
  }
}

function promptFromTerminal(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let ttyStream: ReturnType<typeof createReadStream> | undefined;
    try {
      ttyStream = createReadStream("/dev/tty", { encoding: "utf-8" });
    } catch {
      reject(new Error("Cannot open /dev/tty"));
      return;
    }

    const rl = createInterface({
      input: ttyStream,
      terminal: false,
    });

    printTerminalPrompt({ kind: "question", question });

    rl.once("line", (answer) => {
      rl.close();
      ttyStream?.destroy();
      resolve(answer.trim());
    });

    rl.once("error", (err) => {
      rl.close();
      ttyStream?.destroy();
      reject(err);
    });
  });
}
export const registration = {
	tool: askUserTool,
	runner: runAskUser,
	effect: operatorSurfaceEffect(),
};
