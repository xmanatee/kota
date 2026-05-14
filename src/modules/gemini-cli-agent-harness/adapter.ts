/**
 * `gemini-cli` agent harness — a subprocess adapter around Gemini CLI
 * headless structured output.
 *
 * This harness intentionally uses the installed `gemini` binary instead of
 * the Google Gen AI SDK. The CLI is the surface that honors cached Google
 * sign-in / Code Assist auth, its own tool loop, MCP settings, trusted
 * folders, and release-channel behavior.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type {
  AgentHarness,
  AgentHarnessAuthProbe,
  AgentHarnessReadiness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessUnsupportedOption,
  AgentHarnessWriter,
} from "#core/agent-harness/index.js";
import { probeNativeCliRuntime } from "#core/agent-harness/index.js";

export const GEMINI_CLI_AGENT_HARNESS_NAME = "gemini-cli";

const GEMINI_CLI_UNSUPPORTED_OPTIONS = [
  {
    runOption: "mcpServers",
    option: "mcpServers",
    reason: "Gemini CLI owns its own MCP configuration and does not host KOTA MCP servers.",
  },
  {
    runOption: "allowedTools",
    option: "allowedTools",
    reason: "Gemini CLI owns its own tool catalog and policy engine.",
  },
  {
    runOption: "disallowedTools",
    option: "disallowedTools",
    reason: "Gemini CLI owns its own tool catalog and policy engine.",
  },
  {
    runOption: "canUseTool",
    option: "canUseTool",
    reason: "Gemini CLI tool calls cannot be routed through KOTA's canUseTool gate.",
  },
  {
    runOption: "askOwner",
    option: "askOwner",
    reason: "Gemini CLI cannot host KOTA's owner-question tool in this adapter.",
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
    reason: "The gemini-cli adapter does not accept per-step harnessOptions.",
  },
  {
    runOption: "enableFileCheckpointing",
    option: "enableFileCheckpointing",
    reason: "KOTA file checkpointing is not supported by Gemini CLI.",
  },
  {
    runOption: "thinking",
    option: "thinkingEnabled/thinkingBudget",
    reason: "Gemini CLI owns provider-specific thinking controls outside this neutral surface.",
  },
  {
    runOption: "onMessage",
    option: "onMessage",
    reason: "Gemini CLI emits JSON events, not KotaAgentMessage frames.",
  },
] as const satisfies readonly AgentHarnessUnsupportedOption[];

type GeminiCliError = {
  readonly type?: string;
  readonly message?: string;
  readonly code?: number;
};

type GeminiCliTokens = {
  readonly prompt?: number;
  readonly candidates?: number;
  readonly response?: number;
};

type GeminiCliModelStats = {
  readonly tokens?: GeminiCliTokens;
};

type GeminiCliStats = {
  readonly models?: {
    readonly [modelName: string]: GeminiCliModelStats | undefined;
  };
};

type GeminiCliStreamEvent = {
  readonly type?: string;
  readonly session_id?: string;
  readonly sessionId?: string;
  readonly role?: string;
  readonly content?: string;
  readonly text?: string;
  readonly delta?: string;
  readonly message?: string;
  readonly response?: string | null;
  readonly stats?: GeminiCliStats;
  readonly error?: GeminiCliError | string | null;
};

type GeminiOAuthCreds = {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly expiry_date?: number | string;
};

type GeminiGoogleAccounts = {
  readonly active?: string | { readonly email?: string } | null;
};

type TokenCounts = {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
};

type CollectedGeminiOutput = {
  readonly streamedText: string;
  readonly responseText?: string;
  readonly sessionId?: string;
  readonly cliError?: string;
  readonly tokenCounts: TokenCounts;
  readonly sawStructuredOutput: boolean;
};

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readJsonFile<T>(path: string): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, "utf-8")) as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function hasUsableOAuthCreds(creds: GeminiOAuthCreds): boolean {
  if (isNonEmptyString(creds.refresh_token)) return true;
  if (!isNonEmptyString(creds.access_token)) return false;
  if (creds.expiry_date === undefined) return true;
  const expiry =
    typeof creds.expiry_date === "number"
      ? creds.expiry_date
      : Number.parseInt(creds.expiry_date, 10);
  return Number.isFinite(expiry) && expiry > Date.now();
}

function activeAccountLabel(accounts: GeminiGoogleAccounts): string | null {
  if (typeof accounts.active === "string" && accounts.active.trim()) {
    return accounts.active.trim();
  }
  if (
    accounts.active &&
    typeof accounts.active === "object" &&
    isNonEmptyString(accounts.active.email)
  ) {
    return accounts.active.email;
  }
  return null;
}

function geminiCliAuthReadiness(): AgentHarnessAuthProbe {
  const geminiDir = join(homedir(), ".gemini");
  const oauthPath = join(geminiDir, "oauth_creds.json");
  if (existsSync(oauthPath)) {
    const parsed = readJsonFile<GeminiOAuthCreds>(oauthPath);
    if (!parsed.ok) {
      return {
        kind: "harness-managed-login",
        status: "error",
        required: true,
        command: "gemini",
        detail: `failed to read cached Gemini CLI OAuth credentials: ${parsed.error}`,
        summary: "Gemini CLI cached auth probe failed",
      };
    }
    if (hasUsableOAuthCreds(parsed.value)) {
      return {
        kind: "harness-managed-login",
        status: "ready",
        required: true,
        command: "gemini",
        detail: "cached OAuth credentials found at ~/.gemini/oauth_creds.json",
        summary: "Gemini CLI Google login cached",
      };
    }
  }

  const accountsPath = join(geminiDir, "google_accounts.json");
  if (existsSync(accountsPath)) {
    const parsed = readJsonFile<GeminiGoogleAccounts>(accountsPath);
    if (!parsed.ok) {
      return {
        kind: "harness-managed-login",
        status: "error",
        required: true,
        command: "gemini",
        detail: `failed to read cached Gemini CLI account metadata: ${parsed.error}`,
        summary: "Gemini CLI account probe failed",
      };
    }
    const active = activeAccountLabel(parsed.value);
    if (active) {
      return {
        kind: "harness-managed-login",
        status: "ready",
        required: true,
        command: "gemini",
        detail: "active Gemini CLI Google account metadata found at ~/.gemini/google_accounts.json",
        summary: "Gemini CLI Google account cached",
      };
    }
  }

  return {
    kind: "harness-managed-login",
    status: "missing",
    required: true,
    command: "gemini",
    detail: "no cached Gemini CLI Google OAuth / Code Assist credentials found under ~/.gemini",
    summary: "Gemini CLI login not active; run `gemini` and sign in",
  };
}

function geminiCliReadiness(): AgentHarnessReadiness {
  return {
    adapterKind: "native-cli",
    localRuntime: probeNativeCliRuntime({
      binaryName: "gemini",
      versionArgs: ["--version"],
      required: true,
    }),
    localAuth: geminiCliAuthReadiness(),
    optionalRuntimes: [],
    unsupportedOptions: GEMINI_CLI_UNSUPPORTED_OPTIONS,
  };
}

function rejectUnsupportedOptions(options: AgentHarnessRunOptions): void {
  if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
    throw new Error(
      'The "gemini-cli" agent harness runs through Gemini CLI and does not host KOTA MCP servers. ' +
        "Drop mcpServers or run the claude-agent-sdk harness.",
    );
  }
  if (options.allowedTools && options.allowedTools.length > 0) {
    throw new Error(
      'The "gemini-cli" agent harness cannot constrain Gemini CLI tools through KOTA allowedTools. ' +
        "Drop allowedTools or run a KOTA-hosted tool-loop harness.",
    );
  }
  if (options.disallowedTools && options.disallowedTools.length > 0) {
    throw new Error(
      'The "gemini-cli" agent harness cannot constrain Gemini CLI tools through KOTA disallowedTools. ' +
        "Drop disallowedTools or run a KOTA-hosted tool-loop harness.",
    );
  }
  if (options.canUseTool !== undefined) {
    throw new Error(
      'The "gemini-cli" agent harness cannot route Gemini CLI tool calls through KOTA canUseTool. ' +
        "Drop canUseTool or run a KOTA-hosted tool-loop harness.",
    );
  }
  if (options.askOwner !== undefined) {
    throw new Error(
      'The "gemini-cli" agent harness cannot expose KOTA ask_owner to Gemini CLI. ' +
        "Use deterministic askOwner workflow steps instead.",
    );
  }
  if (options.autonomyMode === "supervised") {
    throw new Error(
      'The "gemini-cli" agent harness runs non-interactively and cannot route tool calls ' +
        "through KOTA's operator approval queue. Use autonomous or passive mode.",
    );
  }
  if (options.persistSession === true) {
    throw new Error(
      'The "gemini-cli" agent harness does not expose KOTA-managed session persistence. ' +
        "Drop persistSession.",
    );
  }
  if (options.harnessOverrides !== undefined) {
    throw new Error(
      'The "gemini-cli" agent harness does not accept per-step harnessOptions. ' +
        'Drop harnessOptions["gemini-cli"].',
    );
  }
  if (options.enableFileCheckpointing === true) {
    throw new Error(
      'The "gemini-cli" agent harness does not support KOTA file checkpointing. ' +
        "Drop enableFileCheckpointing.",
    );
  }
  if (options.thinkingEnabled === true || options.thinkingBudget !== undefined) {
    throw new Error(
      'The "gemini-cli" agent harness does not expose KOTA thinkingEnabled/thinkingBudget. ' +
        "Select a Gemini CLI model or settings profile instead.",
    );
  }
  if (options.onMessage !== undefined) {
    throw new Error(
      'The "gemini-cli" agent harness emits text deltas only, not KotaAgentMessage frames. ' +
        "Drop onMessage.",
    );
  }
}

function geminiApprovalMode(
  options: AgentHarnessRunOptions,
): "default" | "plan" {
  return options.autonomyMode === "passive" ? "plan" : "default";
}

function buildGeminiCliPrompt(options: AgentHarnessRunOptions): string {
  const parts: string[] = [];
  if (options.systemPrompt?.trim()) {
    parts.push("## System instructions", options.systemPrompt.trim());
  }
  parts.push(
    "## KOTA workflow rails",
    "Do not run `git commit`; stage changes and write the requested " +
      "commit-message artifact instead. Do not stop, restart, signal, or " +
      "control the daemon process that launched you.",
    "Gemini CLI owns its native tool loop in this harness. If a task requires " +
      "a KOTA approval, KOTA tool registry call, or KOTA file checkpoint that " +
      "this adapter cannot provide, stop and report that boundary.",
    "## Task",
    options.prompt,
  );
  return parts.join("\n\n");
}

function parseGeminiCliEvent(line: string): GeminiCliStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parsed = JSON.parse(trimmed) as GeminiCliStreamEvent;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Gemini CLI emitted non-object JSON event: ${trimmed}`);
  }
  return parsed;
}

function eventText(event: GeminiCliStreamEvent): string {
  if (isNonEmptyString(event.content)) return event.content;
  if (isNonEmptyString(event.text)) return event.text;
  if (isNonEmptyString(event.delta)) return event.delta;
  return "";
}

function errorMessage(error: GeminiCliError | string | null | undefined): string | undefined {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object" && isNonEmptyString(error.message)) {
    return error.message;
  }
  return undefined;
}

function extractTokenCounts(stats: GeminiCliStats | undefined): TokenCounts {
  const models = stats?.models;
  if (!models) return {};
  let inputTokens = 0;
  let outputTokens = 0;
  let sawInput = false;
  let sawOutput = false;
  for (const modelName of Object.keys(models)) {
    const tokens = models[modelName]?.tokens;
    if (!tokens) continue;
    if (typeof tokens.prompt === "number") {
      inputTokens += tokens.prompt;
      sawInput = true;
    }
    const output = tokens.candidates ?? tokens.response;
    if (typeof output === "number") {
      outputTokens += output;
      sawOutput = true;
    }
  }
  return {
    ...(sawInput ? { inputTokens } : {}),
    ...(sawOutput ? { outputTokens } : {}),
  };
}

function collectGeminiOutput(args: {
  lines: AsyncIterable<string>;
  writer: AgentHarnessWriter | undefined;
}): Promise<CollectedGeminiOutput> {
  return (async () => {
    const chunks: string[] = [];
    let responseText: string | undefined;
    let sessionId: string | undefined;
    let cliError: string | undefined;
    let tokenCounts: TokenCounts = {};
    let sawStructuredOutput = false;

    for await (const line of args.lines) {
      const event = parseGeminiCliEvent(line);
      if (!event) continue;
      sawStructuredOutput = true;
      if (isNonEmptyString(event.session_id)) sessionId = event.session_id;
      if (isNonEmptyString(event.sessionId)) sessionId = event.sessionId;

      if (event.type === "message" && event.role !== "user") {
        const text = eventText(event);
        if (text) {
          chunks.push(text);
          args.writer?.write(text);
        }
      }

      if (event.type === "error") {
        cliError = errorMessage(event.error) ?? event.message ?? "Gemini CLI reported an error";
      }

      if (event.type === "result" || event.type === undefined) {
        if (typeof event.response === "string") responseText = event.response;
        const parsedError = errorMessage(event.error);
        if (parsedError) cliError = parsedError;
        const parsedTokens = extractTokenCounts(event.stats);
        tokenCounts = {
          ...(parsedTokens.inputTokens !== undefined
            ? { inputTokens: parsedTokens.inputTokens }
            : tokenCounts.inputTokens !== undefined
              ? { inputTokens: tokenCounts.inputTokens }
              : {}),
          ...(parsedTokens.outputTokens !== undefined
            ? { outputTokens: parsedTokens.outputTokens }
            : tokenCounts.outputTokens !== undefined
              ? { outputTokens: tokenCounts.outputTokens }
              : {}),
        };
      }
    }

    if (responseText && chunks.length === 0) {
      chunks.push(responseText);
      args.writer?.write(responseText);
    }

    return {
      streamedText: chunks.join(""),
      ...(responseText !== undefined ? { responseText } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(cliError !== undefined ? { cliError } : {}),
      tokenCounts,
      sawStructuredOutput,
    };
  })();
}

function formatStderr(stderr: string[]): string {
  return stderr.join("").trim();
}

function emptyCollectedGeminiOutput(): CollectedGeminiOutput {
  return {
    streamedText: "",
    tokenCounts: {},
    sawStructuredOutput: false,
  };
}

async function collectTextFromGeminiCli(args: {
  prompt: string;
  cwd: string;
  model: string;
  approvalMode: "default" | "plan";
  abortController: AbortController | undefined;
  writer: AgentHarnessWriter | undefined;
}): Promise<AgentHarnessResult> {
  const cliArgs = [
    "--prompt",
    args.prompt,
    "--output-format",
    "stream-json",
    "--model",
    args.model,
    "--approval-mode",
    args.approvalMode,
  ];

  const child = spawn("gemini", cliArgs, {
    cwd: args.cwd,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stderr: string[] = [];
  let spawnError: string | undefined;
  let parseError: string | undefined;

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

  const stderrDone = new Promise<void>((resolve) => {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => stderr.push(chunk));
    child.stderr.on("end", resolve);
  });

  const outputPromise: Promise<CollectedGeminiOutput> = collectGeminiOutput({
    lines: createInterface({ input: child.stdout }),
    writer: args.writer,
  }).catch((err) => {
    parseError = err instanceof Error ? err.message : String(err);
    return emptyCollectedGeminiOutput();
  });

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("error", (err) => {
      spawnError = err.message;
      resolve({ code: null, signal: null });
    });
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  removeAbortListener?.();
  const [output] = await Promise.all([outputPromise, stderrDone]);

  if (args.abortController?.signal.aborted) {
    return {
      text: "Gemini CLI run aborted.",
      streamedText: output.streamedText,
      ...(output.sessionId !== undefined ? { sessionId: output.sessionId } : {}),
      turns: output.sawStructuredOutput ? 1 : 0,
      ...(output.tokenCounts.inputTokens !== undefined
        ? { inputTokens: output.tokenCounts.inputTokens }
        : {}),
      ...(output.tokenCounts.outputTokens !== undefined
        ? { outputTokens: output.tokenCounts.outputTokens }
        : {}),
      isError: true,
      subtype: "aborted",
    };
  }

  if (spawnError !== undefined || parseError !== undefined) {
    const detail =
      spawnError ??
      parseError ??
      "Gemini CLI output could not be parsed as structured JSON";
    return {
      text: detail,
      streamedText: output.streamedText,
      turns: output.sawStructuredOutput ? 1 : 0,
      isError: true,
      subtype: spawnError !== undefined ? "gemini_cli_error" : "gemini_cli_parse_error",
    };
  }

  if (exit.code !== 0 || output.cliError !== undefined) {
    const detail =
      output.cliError ??
      (formatStderr(stderr) ||
        `Gemini CLI exited with code ${exit.code ?? `signal ${exit.signal}`}`);
    return {
      text: detail,
      streamedText: output.streamedText,
      ...(output.sessionId !== undefined ? { sessionId: output.sessionId } : {}),
      turns: output.sawStructuredOutput ? 1 : 0,
      ...(output.tokenCounts.inputTokens !== undefined
        ? { inputTokens: output.tokenCounts.inputTokens }
        : {}),
      ...(output.tokenCounts.outputTokens !== undefined
        ? { outputTokens: output.tokenCounts.outputTokens }
        : {}),
      isError: true,
      subtype: "gemini_cli_error",
    };
  }

  const finalText = output.responseText ?? output.streamedText;
  if (!finalText && !output.streamedText) {
    return {
      text: "Gemini CLI completed without structured output.",
      streamedText: "",
      turns: output.sawStructuredOutput ? 1 : 0,
      isError: true,
      subtype: "gemini_cli_empty_output",
    };
  }

  return {
    text: finalText,
    streamedText: output.streamedText,
    ...(output.sessionId !== undefined ? { sessionId: output.sessionId } : {}),
    turns: 1,
    ...(output.tokenCounts.inputTokens !== undefined
      ? { inputTokens: output.tokenCounts.inputTokens }
      : {}),
    ...(output.tokenCounts.outputTokens !== undefined
      ? { outputTokens: output.tokenCounts.outputTokens }
      : {}),
    isError: false,
  };
}

export const geminiCliAgentHarness: AgentHarness = {
  name: GEMINI_CLI_AGENT_HARNESS_NAME,
  description:
    "Runs the installed Gemini CLI (`gemini --output-format stream-json`) so KOTA uses Gemini CLI Google login / Code Assist auth from local CLI state.",
  supportsMultiTurn: true,
  supportedHookKinds: ["preRun", "postRun"] as const,
  askOwnerToolName: null,
  emitsAgentMessageStream: false,
  unsupportedRunOptions: GEMINI_CLI_UNSUPPORTED_OPTIONS,
  readiness: geminiCliReadiness,
  async run(
    options: AgentHarnessRunOptions,
    writer?: AgentHarnessWriter,
  ): Promise<AgentHarnessResult> {
    rejectUnsupportedOptions(options);
    if (!options.model) {
      throw new Error(
        'The "gemini-cli" agent harness requires an explicit model on the step or config.',
      );
    }
    return collectTextFromGeminiCli({
      prompt: buildGeminiCliPrompt(options),
      cwd: options.cwd ?? process.cwd(),
      model: options.model,
      approvalMode: geminiApprovalMode(options),
      abortController: options.abortController,
      writer,
    });
  },
};
