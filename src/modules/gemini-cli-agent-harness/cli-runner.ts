import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type {
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
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
  nativeCliWorkspaceConfigurationReadRoots,
} from "#core/agent-harness/native-cli-sandbox-roots.js";
import {
  type CollectedGeminiOutput,
  collectGeminiOutput,
  emptyCollectedGeminiOutput,
} from "./cli-output.js";
import {
  GEMINI_CLI_AUTH_DIR_ENV,
  prepareGeminiCliRuntimeEnvironment,
} from "./runtime-home.js";

export type GeminiCliApprovalMode = "default" | "plan";

const GEMINI_CLI_AUTH_ENV_KEYS = [
  GEMINI_CLI_AUTH_DIR_ENV,
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
] as const;

const GEMINI_CLI_PROJECT_ENV_KEYS = [
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_PROJECT_ID",
  "GOOGLE_CLOUD_LOCATION",
  "GOOGLE_GENAI_USE_VERTEXAI",
] as const;

const GEMINI_CLI_PROVIDER_EGRESS_HOSTS = [
  "accounts.google.com",
  "aiplatform.googleapis.com",
  "cloudcode-pa.googleapis.com",
  "daily-cloudcode-pa.googleapis.com",
  "generativelanguage.googleapis.com",
  "oauth2.googleapis.com",
] as const;

function formatStderr(stderr: string[]): string {
  return stderr.join("").trim();
}

type CollectTextFromGeminiCliArgs = {
  prompt: string;
  cwd: string;
  model: string;
  approvalMode: GeminiCliApprovalMode;
  writableRoots: readonly string[];
  authorityConfigPath: string | undefined;
  env: Record<string, string> | undefined;
  abortController: AbortController | undefined;
  writer: AgentHarnessWriter | undefined;
  onMessage: AgentHarnessRunOptions["onMessage"] | undefined;
};

async function runGeminiCliProcess(
  args: CollectTextFromGeminiCliArgs,
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

  const outputPromise: Promise<CollectedGeminiOutput> = collectGeminiOutput({
    lines: createInterface({ input: child.stdout }),
    writer: args.writer,
    onMessage: args.onMessage,
  }).catch((err) => {
    parseError = err instanceof Error ? err.message : String(err);
    signalNativeCliProcessGroup(child, "SIGTERM");
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
      subtype: isNativeCliSandboxBootstrapError(detail)
        ? "native_cli_sandbox_error"
        : "gemini_cli_error",
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

export async function collectTextFromGeminiCli(
  args: CollectTextFromGeminiCliArgs,
): Promise<AgentHarnessResult> {
  const cliArgs = [
    "--skip-trust",
    "--prompt",
    args.prompt,
    "--output-format",
    "stream-json",
    "--model",
    args.model,
    "--approval-mode",
    args.approvalMode,
  ];
  return withNativeCliSandbox(
    "gemini",
    cliArgs,
    {
      cwd: args.cwd,
      authorityConfigPath: args.authorityConfigPath,
      writableRoots: args.writableRoots,
      env: buildNativeCliEnvironment({
        projectedEnvKeys: [
          ...GEMINI_CLI_AUTH_ENV_KEYS,
          ...GEMINI_CLI_PROJECT_ENV_KEYS,
        ],
        authenticationEnvKeys: GEMINI_CLI_AUTH_ENV_KEYS,
        overrides: {
          ...(args.env ?? {}),
          NO_COLOR: "1",
        },
      }),
      allowedEgressHosts: GEMINI_CLI_PROVIDER_EGRESS_HOSTS,
      readOnlyHostRoots: nativeCliWorkspaceConfigurationReadRoots(args.cwd, [
        ".gemini/settings.json",
      ]),
      prepareEnvironment: prepareGeminiCliRuntimeEnvironment,
    },
    (sandboxedProcess) => runGeminiCliProcess(args, sandboxedProcess),
  );
}
