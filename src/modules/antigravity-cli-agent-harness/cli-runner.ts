import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type {
  AgentEffort,
  AgentHarnessResult,
  AgentHarnessWriter,
  KotaAgentMessage,
} from "#core/agent-harness/index.js";
import { buildNativeCliEnvironment } from "#core/agent-harness/native-cli-environment.js";
import {
  NATIVE_CLI_PROCESS_GROUP_SPAWN_OPTIONS,
  signalNativeCliProcessGroup,
} from "#core/agent-harness/native-cli-process-group.js";
import {
  isNativeCliSandboxBootstrapError,
  type NativeCliSandboxProcess,
  withNativeCliSandbox,
} from "#core/agent-harness/native-cli-sandbox.js";
import {
  type CollectedAntigravityOutput,
  collectAntigravityOutput,
  emptyCollectedAntigravityOutput,
} from "./cli-output.js";
import {
  ANTIGRAVITY_CLI_KEYCHAIN_DIR_ENV,
  prepareAntigravityCliRuntimeEnvironment,
  resolveAntigravityCliKeychainDirectory,
} from "./runtime-home.js";

export const ANTIGRAVITY_CLI_BINARY_NAME = "agy";

const ANTIGRAVITY_CLI_PRINT_TIMEOUT = "24h";

const ANTIGRAVITY_PROVIDER_EGRESS_HOSTS = [
  "accounts.google.com",
  "aiplatform.googleapis.com",
  "businessaicode.googleapis.com",
  "cloudcode-pa.googleapis.com",
  "daily-cloudcode-pa.googleapis.com",
  "generativelanguage.googleapis.com",
  "lh3.googleusercontent.com",
  "oauth2.googleapis.com",
  "www.googleapis.com",
] as const;

export function abortedAntigravityCliResult(): AgentHarnessResult {
  return {
    text: "Antigravity CLI run aborted.",
    streamedText: "",
    turns: 0,
    isError: true,
    subtype: "aborted",
  };
}

function formatStderr(chunks: readonly string[]): string {
  return chunks.join("").trim();
}

type CollectTextFromAntigravityCliArgs = {
  prompt: string;
  cwd: string;
  model: string;
  effort: AgentEffort;
  passive: boolean;
  writableRoots: readonly string[];
  authorityConfigPath: string | undefined;
  env: Record<string, string> | undefined;
  abortController?: AbortController;
  writer?: AgentHarnessWriter;
  onMessage?: (message: KotaAgentMessage) => void | Promise<void>;
};

function antigravityCliEffort(effort: AgentEffort): "low" | "medium" | "high" {
  return effort === "low" || effort === "medium" ? effort : "high";
}

async function runAntigravityCliProcess(
  args: CollectTextFromAntigravityCliArgs,
  sandboxedProcess: NativeCliSandboxProcess,
): Promise<AgentHarnessResult> {
  const child = spawn(sandboxedProcess.command, sandboxedProcess.args, {
    cwd: args.cwd,
    env: sandboxedProcess.env,
    ...NATIVE_CLI_PROCESS_GROUP_SPAWN_OPTIONS,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stderr: string[] = [];
  let spawnError: string | undefined;
  let parseError: string | undefined;

  const abort = (): void => {
    signalNativeCliProcessGroup(child, "SIGKILL");
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
  const outputPromise: Promise<CollectedAntigravityOutput> =
    collectAntigravityOutput({
      lines: createInterface({ input: child.stdout }),
      writer: args.writer,
      onMessage: args.onMessage,
    }).catch((error) => {
      parseError = error instanceof Error ? error.message : String(error);
      signalNativeCliProcessGroup(child, "SIGTERM");
      return emptyCollectedAntigravityOutput();
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
      text: "Antigravity CLI run aborted.",
      streamedText: output.streamedText,
      ...(output.sessionId !== undefined ? { sessionId: output.sessionId } : {}),
      turns: output.turns,
      ...(output.inputTokens !== undefined ? { inputTokens: output.inputTokens } : {}),
      ...(output.outputTokens !== undefined ? { outputTokens: output.outputTokens } : {}),
      isError: true,
      subtype: "aborted",
    };
  }

  if (spawnError !== undefined || parseError !== undefined) {
    const detail = spawnError ?? parseError ??
      "Antigravity CLI output could not be parsed as structured JSON";
    return {
      text: detail,
      streamedText: output.streamedText,
      turns: output.turns,
      isError: true,
      subtype: spawnError === undefined
        ? "antigravity_cli_parse_error"
        : "antigravity_cli_error",
    };
  }

  if (exit.code !== 0 || output.cliError !== undefined) {
    const detail =
      output.cliError ??
      (formatStderr(stderr) ||
        `Antigravity CLI exited with code ${exit.code ?? `signal ${exit.signal}`}`);
    return {
      text: detail,
      streamedText: output.streamedText,
      ...(output.sessionId !== undefined ? { sessionId: output.sessionId } : {}),
      turns: output.turns,
      ...(output.inputTokens !== undefined ? { inputTokens: output.inputTokens } : {}),
      ...(output.outputTokens !== undefined ? { outputTokens: output.outputTokens } : {}),
      isError: true,
      subtype: isNativeCliSandboxBootstrapError(detail)
        ? "native_cli_sandbox_error"
        : "antigravity_cli_error",
    };
  }

  const text = output.responseText ?? output.streamedText;
  if (!text) {
    return {
      text: "Antigravity CLI completed without structured output.",
      streamedText: "",
      turns: output.turns,
      isError: true,
      subtype: "antigravity_cli_empty_output",
    };
  }

  return {
    text,
    streamedText: output.streamedText,
    ...(output.sessionId !== undefined ? { sessionId: output.sessionId } : {}),
    turns: output.turns,
    ...(output.inputTokens !== undefined ? { inputTokens: output.inputTokens } : {}),
    ...(output.outputTokens !== undefined ? { outputTokens: output.outputTokens } : {}),
    isError: false,
  };
}

export async function collectTextFromAntigravityCli(
  args: CollectTextFromAntigravityCliArgs,
): Promise<AgentHarnessResult> {
  const keychainDirectory = resolveAntigravityCliKeychainDirectory({
    ...process.env,
    ...(args.env ?? {}),
  });
  const cliArgs = [
    "--new-project",
    "--print",
    args.prompt,
    "--model",
    args.model,
    "--effort",
    antigravityCliEffort(args.effort),
    "--mode",
    args.passive ? "plan" : "accept-edits",
    "--dangerously-skip-permissions",
    "--output-format",
    "stream-json",
    "--print-timeout",
    ANTIGRAVITY_CLI_PRINT_TIMEOUT,
  ];
  return withNativeCliSandbox(
    ANTIGRAVITY_CLI_BINARY_NAME,
    cliArgs,
    {
      cwd: args.cwd,
      authorityConfigPath: args.authorityConfigPath,
      writableRoots: args.writableRoots,
      env: buildNativeCliEnvironment({
        projectedEnvKeys: [ANTIGRAVITY_CLI_KEYCHAIN_DIR_ENV],
        overrides: {
          ...(args.env ?? {}),
          ...(keychainDirectory === undefined
            ? {}
            : { [ANTIGRAVITY_CLI_KEYCHAIN_DIR_ENV]: keychainDirectory }),
          NO_COLOR: "1",
        },
      }),
      readOnlyHostRoots: keychainDirectory === undefined
        ? []
        : [keychainDirectory],
      allowedEgressHosts: ANTIGRAVITY_PROVIDER_EGRESS_HOSTS,
      prepareEnvironment: prepareAntigravityCliRuntimeEnvironment,
    },
    (sandboxedProcess) =>
      runAntigravityCliProcess(args, sandboxedProcess),
  );
}
