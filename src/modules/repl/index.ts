/**
 * REPL module — harness-neutral interactive terminal client. Drives any
 * registered `AgentHarness` adapter turn-by-turn. The CLI `run -i` path
 * for harness-backed providers calls `runHarnessRepl` from this module.
 *
 * Operator chrome (banners, status, errors) is resolved through the
 * rendering provider seam exposed by `RenderingProvider.createReplChrome()`,
 * so this module depends on `rendering` but does not import it directly.
 */
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import {
  type AgentHarness,
  type AgentHarnessResult,
  type AgentHarnessRunOptions,
  type AgentHarnessWriter,
  runAgentHarness,
} from "#core/agent-harness/index.js";
import type { KotaModule } from "#core/modules/module-types.js";
import { getRenderingProvider } from "#core/modules/provider-registry.js";
import type { ReplChrome } from "#core/modules/provider-types.js";
import { expandUserPromptReferences } from "#core/prompt-input/index.js";

/** Minimal writable-stream surface used for the assistant's streamed output. */
export type ReplOutputStream = {
  write(chunk: string): boolean;
};

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
   * Chrome surface for REPL banners, help, status, and errors. When
   * omitted the REPL resolves the rendering module's default chrome
   * through the provider registry; deployments without the rendering
   * module must supply one explicitly or the REPL refuses to start.
   */
  chrome?: ReplChrome;
  /**
   * Writer that receives the assistant's streamed output. Defaults to
   * `process.stdout`. Tests capture the stream to assert what the
   * operator sees.
   */
  output?: ReplOutputStream;
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

function streamWriter(stream: ReplOutputStream): AgentHarnessWriter {
  return {
    write(text: string): boolean {
      return stream.write(text);
    },
  };
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
  chrome: ReplChrome,
  state: ReplState,
  harness: AgentHarness,
  model: string,
): boolean {
  switch (command) {
    case "/help": {
      chrome.showHelp(REPL_COMMANDS);
      return true;
    }
    case "/status": {
      chrome.showStatus(harness.name, model, state.turnsOut);
      return true;
    }
    case "/reset":
    case "/clear": {
      state.transcript.length = 0;
      state.turnsOut = 0;
      chrome.showReset();
      return true;
    }
    default:
      return false;
  }
}

function resolveChrome(explicit: ReplChrome | undefined): ReplChrome {
  if (explicit) return explicit;
  const provider = getRenderingProvider();
  if (!provider) {
    throw new Error(
      "runHarnessRepl requires a ReplChrome: pass `chrome` explicitly or load the `rendering` module so the REPL can resolve one from the provider registry.",
    );
  }
  return provider.createReplChrome();
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

  const chrome = resolveChrome(options.chrome);
  const output: ReplOutputStream = options.output ?? process.stdout;
  const writer = streamWriter(output);
  const inputStream = options.input ?? process.stdin;

  chrome.announceHarness(options.harness, options.model);

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
      const result = await runAgentHarness(
        options.harness,
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
      chrome.showError((err as Error).message);
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

  chrome.showGoodbye();
}

const replModule: KotaModule = {
  name: "repl",
  version: "1.0.0",
  description:
    "Harness-neutral interactive terminal REPL for AgentHarness adapters.",
};

export default replModule;
