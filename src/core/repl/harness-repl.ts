import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
} from "#core/agent-harness/index.js";
import { expandUserPromptReferences } from "#core/prompt-input/index.js";
import { blank, line, plain, span } from "#modules/rendering/primitives.js";
import type { TransportStream } from "#modules/rendering/transport.js";
import { TerminalTransport } from "#modules/rendering/transport.js";

export type HarnessReplRunOverrides = Omit<
  AgentHarnessRunOptions,
  "prompt"
>;

export type HarnessReplOptions = {
  harness: AgentHarness;
  model: string;
  cwd: string;
  run: HarnessReplRunOverrides;
  /**
   * Stream to read user input from (lines). Defaults to `process.stdin`.
   * Tests inject a ReadableStream-like source to drive the REPL without
   * needing a real TTY.
   */
  input?: NodeJS.ReadableStream;
  /**
   * Transport for REPL chrome (banner, status, errors). Defaults to a
   * TerminalTransport around `process.stderr`. The harness writer below
   * handles assistant-streaming output.
   */
  chrome?: TerminalTransport;
  /**
   * Writer that receives the assistant's streamed output. Defaults to a
   * TransportStream adapter around `process.stdout`. Tests capture the
   * stream to assert what the operator sees.
   */
  output?: TransportStream;
};

type ReplTurn = {
  user: string;
  assistant: string;
};

/**
 * Compose the transcript into a single prompt string. Adapters that do not
 * own native conversation state (thin) still see the full history; adapters
 * that do (claude-agent-sdk via its native tool loop) still receive the full
 * context since the REPL drives them fresh each turn.
 */
export function composeTranscriptPrompt(
  transcript: ReplTurn[],
  userInput: string,
): string {
  if (transcript.length === 0) return userInput;
  const parts: string[] = [
    "The following is the running transcript of an interactive REPL session. Respond only to the final user message; the earlier turns are context.",
    "",
  ];
  for (const turn of transcript) {
    parts.push("<user>");
    parts.push(turn.user);
    parts.push("</user>");
    parts.push("<assistant>");
    parts.push(turn.assistant);
    parts.push("</assistant>");
    parts.push("");
  }
  parts.push("<user>");
  parts.push(userInput);
  parts.push("</user>");
  return parts.join("\n");
}

function streamWriter(stream: TransportStream): AgentHarnessWriter {
  return {
    write(text: string): boolean {
      return stream.write(text);
    },
  };
}

function announceHarness(
  chrome: TerminalTransport,
  harness: AgentHarness,
  model: string,
): void {
  chrome.write(
    line(
      span("kota ", "muted"),
      span(`[${harness.name}]`, "accent"),
      span(" ", "muted"),
      span(model, "info"),
      plain("  "),
      span("interactive", "muted"),
    ),
  );
  chrome.write(
    line(
      span(harness.description, "muted"),
    ),
  );
  chrome.write(blank());
}

const REPL_COMMANDS: Record<string, string> = {
  "/help": "Show available commands",
  "/status": "Show session info (harness, model, turn count)",
  "/reset": "Clear conversation transcript and start fresh",
  "/clear": "Clear conversation transcript and start fresh",
};

type ReplState = {
  transcript: ReplTurn[];
  turnsOut: number;
  lastResult?: AgentHarnessResult;
};

function handleReplCommand(
  command: string,
  chrome: TerminalTransport,
  state: ReplState,
  harness: AgentHarness,
  model: string,
): boolean {
  switch (command) {
    case "/help": {
      for (const [cmd, desc] of Object.entries(REPL_COMMANDS)) {
        chrome.write(
          line(span(`  ${cmd.padEnd(10)}`, "accent"), plain(` ${desc}`)),
        );
      }
      chrome.write(
        line(span("  exit      ", "accent"), plain(" Quit interactive mode")),
      );
      return true;
    }
    case "/status": {
      chrome.write(
        line(
          span("Harness: ", "muted"),
          span(harness.name, "info"),
          plain("  "),
          span("Model: ", "muted"),
          span(model, "info"),
          plain("  "),
          span("Turns: ", "muted"),
          plain(String(state.turnsOut)),
        ),
      );
      return true;
    }
    case "/reset":
    case "/clear": {
      state.transcript.length = 0;
      state.turnsOut = 0;
      chrome.write(line(span("Transcript cleared.", "success")));
      return true;
    }
    default:
      return false;
  }
}

/**
 * Interactive REPL entry point for any `AgentHarness`.
 *
 * Maintains a local transcript and delivers a composed prompt to
 * `harness.run` per turn. `@path` expansion happens at this boundary — the
 * adapter sees the already-expanded text. The REPL refuses to launch for
 * harnesses that declare `supportsMultiTurn: false`.
 */
export async function runHarnessRepl(options: HarnessReplOptions): Promise<void> {
  if (!options.harness.supportsMultiTurn) {
    throw new Error(
      `Agent harness "${options.harness.name}" does not support multi-turn conversation and cannot host an interactive REPL.`,
    );
  }

  const chrome = options.chrome ?? new TerminalTransport({ stream: process.stderr });
  const output = options.output ?? (process.stdout as unknown as TransportStream);
  const writer = streamWriter(output);
  const inputStream = options.input ?? process.stdin;

  announceHarness(chrome, options.harness, options.model);

  const rl: ReadlineInterface = createInterface({
    input: inputStream,
    output: process.stderr,
    prompt: "kota> ",
    terminal: false,
  });

  const state: ReplState = { transcript: [], turnsOut: 0 };

  const processLine = async (rawLine: string): Promise<"continue" | "exit"> => {
    const input = rawLine.trim();
    if (!input) return "continue";
    if (input === "exit" || input === "quit") return "exit";

    if (
      handleReplCommand(input, chrome, state, options.harness, options.model)
    ) {
      return "continue";
    }

    const expanded = expandUserPromptReferences(input, options.cwd).text;
    const composed = composeTranscriptPrompt(state.transcript, expanded);

    try {
      const result = await options.harness.run(
        {
          ...options.run,
          prompt: composed,
          model: options.model,
          cwd: options.cwd,
        },
        writer,
      );
      state.lastResult = result;
      state.turnsOut += 1;
      state.transcript.push({
        user: expanded,
        assistant: result.text,
      });
      output.write("\n");
    } catch (err) {
      chrome.write(
        line(span(`Error: ${(err as Error).message}`, "error")),
      );
    }
    return "continue";
  };

  rl.prompt();

  for await (const rawLine of rl) {
    const action = await processLine(rawLine);
    if (action === "exit") {
      rl.close();
      break;
    }
    rl.prompt();
  }

  chrome.write(blank());
  chrome.write(line(span("Goodbye.", "muted")));
}
