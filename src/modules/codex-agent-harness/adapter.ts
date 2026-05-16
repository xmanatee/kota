/**
 * `codex` agent harness — a subprocess adapter around `codex exec --json`.
 *
 * This harness intentionally uses the installed Codex CLI instead of the
 * OpenAI Agents SDK. The CLI is the surface that honors `codex login` /
 * ChatGPT-plan subscription auth, so KOTA's default Codex preset must route
 * through it rather than requiring `OPENAI_API_KEY`.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type {
  AgentEffort,
  AgentHarness,
  AgentHarnessReadiness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessUnsupportedOption,
  AgentHarnessWriter,
} from "#core/agent-harness/index.js";
import {
  probeNativeCliAuth,
  probeNativeCliRuntime,
} from "#core/agent-harness/index.js";

export const CODEX_AGENT_HARNESS_NAME = "codex";

const CODEX_UNSUPPORTED_OPTIONS = [
  {
    runOption: "mcpServers",
    option: "mcpServers",
    reason: "Codex CLI owns its own tool runtime and does not host KOTA MCP servers.",
  },
  {
    runOption: "allowedTools",
    option: "allowedTools",
    reason: "Codex CLI tool policy cannot be constrained through KOTA allowedTools.",
  },
  {
    runOption: "disallowedTools",
    option: "disallowedTools",
    reason: "Codex CLI tool policy cannot be constrained through KOTA disallowedTools.",
  },
  {
    runOption: "canUseTool",
    option: "canUseTool",
    reason: "Codex CLI tool calls cannot be routed through KOTA's canUseTool gate.",
  },
  {
    runOption: "autonomyMode.supervised",
    option: 'autonomyMode="supervised"',
    reason: "The non-interactive CLI path cannot route approvals through KOTA's queue.",
  },
  {
    runOption: "persistSession",
    option: "persistSession",
    reason: "KOTA-managed session persistence is not exposed by this adapter.",
  },
  {
    runOption: "harnessOverrides",
    option: "harnessOverrides",
    reason: "The codex adapter does not accept per-step harnessOptions.",
  },
  {
    runOption: "enableFileCheckpointing",
    option: "enableFileCheckpointing",
    reason: "KOTA file checkpointing is not supported by Codex CLI.",
  },
  {
    runOption: "thinking",
    option: "thinkingEnabled/thinkingBudget",
    reason: "Portable effort maps to Codex CLI model_reasoning_effort instead.",
  },
  {
    runOption: "onMessage",
    option: "onMessage",
    reason: "Codex CLI emits text deltas, not KotaAgentMessage frames.",
  },
] as const satisfies readonly AgentHarnessUnsupportedOption[];

function codexReadiness(): AgentHarnessReadiness {
  return {
    adapterKind: "native-cli",
    localRuntime: probeNativeCliRuntime({
      binaryName: "codex",
      versionArgs: ["--version"],
      required: true,
    }),
    localAuth: probeNativeCliAuth({
      binaryName: "codex",
      statusArgs: ["login", "status"],
      required: true,
      readyPattern: /logged in using chatgpt/i,
      missingPattern:
        /not logged in|not authenticated|logged out|no login|login required|api key/i,
      readySummary: "Codex ChatGPT login active",
      missingSummary: "Codex ChatGPT login not active; run `codex login`",
    }),
    optionalRuntimes: [],
    unsupportedOptions: CODEX_UNSUPPORTED_OPTIONS,
  };
}

type CodexCliUsage = {
  input_tokens?: number;
  output_tokens?: number;
};

type CodexCliEvent = {
  type?: string;
  thread_id?: string;
  usage?: CodexCliUsage;
  item?: {
    type?: string;
    text?: string;
  };
  message?: string;
};

function rejectUnsupportedOptions(options: AgentHarnessRunOptions): void {
  if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
    throw new Error(
      'The "codex" agent harness runs through Codex CLI and does not host KOTA MCP servers. ' +
        "Drop mcpServers or run the claude-agent-sdk harness.",
    );
  }
  if (options.allowedTools && options.allowedTools.length > 0) {
    throw new Error(
      'The "codex" agent harness cannot constrain Codex CLI tools through KOTA allowedTools. ' +
        "Drop allowedTools or run a KOTA-hosted tool-loop harness.",
    );
  }
  if (options.disallowedTools && options.disallowedTools.length > 0) {
    throw new Error(
      'The "codex" agent harness cannot constrain Codex CLI tools through KOTA disallowedTools. ' +
        "Drop disallowedTools or run a KOTA-hosted tool-loop harness.",
    );
  }
  if (options.canUseTool !== undefined) {
    throw new Error(
      'The "codex" agent harness cannot route Codex CLI tool calls through KOTA canUseTool. ' +
        "Drop canUseTool or run a KOTA-hosted tool-loop harness.",
    );
  }
  if (options.autonomyMode === "supervised") {
    throw new Error(
      'The "codex" agent harness runs non-interactively and cannot route tool calls ' +
        "through KOTA's operator approval queue. Use autonomous or passive mode.",
    );
  }
  if (options.persistSession === true) {
    throw new Error(
      'The "codex" agent harness does not expose KOTA-managed session persistence. ' +
        "Drop persistSession.",
    );
  }
  if (options.harnessOverrides !== undefined) {
    throw new Error(
      'The "codex" agent harness does not accept per-step harnessOptions. ' +
        'Drop harnessOptions["codex"].',
    );
  }
  if (options.enableFileCheckpointing === true) {
    throw new Error(
      'The "codex" agent harness does not support KOTA file checkpointing. ' +
        "Drop enableFileCheckpointing.",
    );
  }
  if (options.thinkingEnabled === true || options.thinkingBudget !== undefined) {
    throw new Error(
      'The "codex" agent harness maps portable effort to Codex CLI reasoning. ' +
        "Drop thinkingEnabled/thinkingBudget and use effort.",
    );
  }
  if (options.onMessage !== undefined) {
    throw new Error(
      'The "codex" agent harness emits text deltas only, not KotaAgentMessage frames. ' +
        "Drop onMessage.",
    );
  }
}

function mapEffortToCodexReasoning(
  effort: AgentEffort,
): "low" | "medium" | "high" | "xhigh" {
  if (effort === "low") return "low";
  if (effort === "medium") return "medium";
  if (effort === "high") return "high";
  return "xhigh";
}

function codexSandboxMode(
  options: AgentHarnessRunOptions,
): "read-only" | "workspace-write" {
  return options.autonomyMode === "passive" ? "read-only" : "workspace-write";
}

function buildCodexPrompt(options: AgentHarnessRunOptions): string {
  const parts: string[] = [];
  if (options.systemPrompt?.trim()) {
    parts.push("## System instructions", options.systemPrompt.trim());
  }
  parts.push(
    "## KOTA workflow rails",
    "Do not run `git commit`; stage changes and write the requested " +
      "commit-message artifact instead. Do not stop, restart, signal, or " +
      "control the daemon process that launched you.",
    "## Task",
    options.prompt,
  );
  return parts.join("\n\n");
}

function parseCodexEvent(line: string): CodexCliEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parsed: unknown = JSON.parse(trimmed);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Codex CLI emitted non-object JSON event: ${trimmed}`);
  }
  return parsed as CodexCliEvent;
}

function formatStderr(stderr: string[]): string {
  return stderr.join("").trim();
}

async function collectTextFromCodexCli(args: {
  prompt: string;
  cwd: string;
  model: string;
  effort: AgentEffort;
  sandbox: "read-only" | "workspace-write";
  abortController: AbortController | undefined;
  writer: AgentHarnessWriter | undefined;
}): Promise<AgentHarnessResult> {
  const cliArgs = [
    "exec",
    "--json",
    "--model",
    args.model,
    "--cd",
    args.cwd,
    "--sandbox",
    args.sandbox,
    "--skip-git-repo-check",
    "--color",
    "never",
    "-c",
    'preferred_auth_method="chatgpt"',
    "-c",
    `model_reasoning_effort="${mapEffortToCodexReasoning(args.effort)}"`,
    "-c",
    'approval_policy="never"',
    "-",
  ];

  const child = spawn("codex", cliArgs, {
    cwd: args.cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const stderr: string[] = [];
  const streamedChunks: string[] = [];
  let sessionId: string | undefined;
  let turns = 0;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let cliError: string | undefined;

  const abort = (): void => {
    child.kill("SIGTERM");
  };
  let removeAbortListener: (() => void) | undefined;
  if (args.abortController) {
    if (args.abortController.signal.aborted) abort();
    else {
      args.abortController.signal.addEventListener("abort", abort, { once: true });
      removeAbortListener = () =>
        args.abortController?.signal.removeEventListener("abort", abort);
    }
  }

  child.stdin.end(args.prompt);

  const stderrDone = new Promise<void>((resolve) => {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => stderr.push(chunk));
    child.stderr.on("end", resolve);
  });

  const stdoutDone = (async (): Promise<void> => {
    const lines = createInterface({ input: child.stdout });
    for await (const line of lines) {
      const event = parseCodexEvent(line);
      if (!event) continue;
      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        sessionId = event.thread_id;
      } else if (event.type === "item.completed" && event.item?.type === "agent_message") {
        const text = event.item.text ?? "";
        streamedChunks.push(text);
        args.writer?.write(text);
      } else if (event.type === "turn.completed") {
        turns += 1;
        inputTokens = event.usage?.input_tokens;
        outputTokens = event.usage?.output_tokens;
      } else if (event.type === "error") {
        cliError = event.message ?? "Codex CLI reported an error";
      }
    }
  })();

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  removeAbortListener?.();
  await Promise.all([stdoutDone, stderrDone]);

  if (args.abortController?.signal.aborted) {
    return {
      text: "Codex CLI run aborted.",
      streamedText: streamedChunks.join(""),
      ...(sessionId !== undefined ? { sessionId } : {}),
      turns,
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      isError: true,
      subtype: "aborted",
    };
  }

  if (exit.code !== 0 || cliError !== undefined) {
    const detail =
      cliError ??
      (formatStderr(stderr) ||
        `Codex CLI exited with code ${exit.code ?? `signal ${exit.signal}`}`);
    return {
      text: detail,
      streamedText: streamedChunks.join(""),
      ...(sessionId !== undefined ? { sessionId } : {}),
      turns,
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      isError: true,
      subtype: "codex_cli_error",
    };
  }

  return {
    text: streamedChunks.join(""),
    streamedText: streamedChunks.join(""),
    ...(sessionId !== undefined ? { sessionId } : {}),
    turns: turns || (streamedChunks.length > 0 ? 1 : 0),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    isError: false,
  };
}

export const codexAgentHarness: AgentHarness = {
  name: CODEX_AGENT_HARNESS_NAME,
  description:
    "Runs the installed Codex CLI (`codex exec --json`) so KOTA uses Codex ChatGPT-plan subscription auth from `codex login`.",
  supportsMultiTurn: true,
  supportedHookKinds: ["preRun", "postRun"] as const,
  askOwnerToolName: null,
  emitsAgentMessageStream: false,
  toolControl: "native",
  unsupportedRunOptions: CODEX_UNSUPPORTED_OPTIONS,
  readiness: codexReadiness,
  async run(
    options: AgentHarnessRunOptions,
    writer?: AgentHarnessWriter,
  ): Promise<AgentHarnessResult> {
    rejectUnsupportedOptions(options);
    if (!options.model) {
      throw new Error(
        'The "codex" agent harness requires an explicit model on the step or config.',
      );
    }
    return collectTextFromCodexCli({
      prompt: buildCodexPrompt(options),
      cwd: options.cwd ?? process.cwd(),
      model: options.model,
      effort: options.effort,
      sandbox: codexSandboxMode(options),
      abortController: options.abortController,
      writer,
    });
  },
};
