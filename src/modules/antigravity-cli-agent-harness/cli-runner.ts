import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type {
  AgentEffort,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
  KotaAgentMessage,
} from "#core/agent-harness/index.js";
import {
  NATIVE_CLI_PROCESS_GROUP_SPAWN_OPTIONS,
  signalNativeCliProcessGroup,
} from "#core/agent-harness/native-cli-process-group.js";
import {
  isNativeCliSandboxBootstrapError,
  type NativeCliSandboxProcess,
  withNativeCliSandbox,
} from "#core/agent-harness/native-cli-sandbox.js";
import type { AgentOutputSchema } from "#core/agent-harness/types.js";
import { unpricedAgentUsage } from "#core/agent-harness/usage.js";
import { ProcessSupervisor } from "#core/execution/process-supervisor.js";
import {
  type CollectedAntigravityOutput,
  collectAntigravityOutput,
  emptyCollectedAntigravityOutput,
} from "./cli-output.js";
import { resolveAntigravityCliEffort } from "./model-readiness.js";
import {
  ANTIGRAVITY_CLI_PROVIDER_EGRESS_HOSTS,
  buildAntigravityCliEnvironment,
} from "./provider-egress.js";
import {
  prepareAntigravityCliRuntimeEnvironment,
  resolveAntigravityCliKeychainDirectory,
} from "./runtime-home.js";

export const ANTIGRAVITY_CLI_BINARY_NAME = "agy";
export const ANTIGRAVITY_CLI_UNCONFIRMED_STOP_SUBTYPE =
  "antigravity_cli_unconfirmed_remote_stop";

const ANTIGRAVITY_CLI_PRINT_TIMEOUT = "24h";

function formatStderr(chunks: readonly string[]): string {
  return chunks.join("").trim();
}

function terminalToolFailure(
  output: CollectedAntigravityOutput,
): { detail: string; subtype: string } | undefined {
  if (output.lastToolFailure === undefined) return undefined;
  if (output.structuredOutput !== undefined) return undefined;
  if ((output.responseText ?? output.streamedText).trim().length > 0) return undefined;

  const { toolName, detail } = output.lastToolFailure;
  const message = toolName === undefined
    ? detail
    : `Antigravity CLI completed without a response after tool "${toolName}" failed: ${detail}`;
  return {
    detail: message,
    subtype: isNativeCliSandboxBootstrapError(detail)
      ? "native_cli_sandbox_error"
      : /\b(?:denied|permission)\b/i.test(detail)
      ? "antigravity_cli_permission_error"
      : "antigravity_cli_tool_error",
  };
}

type CollectTextFromAntigravityCliArgs = {
  prompt: string;
  cwd: string;
  model: string;
  effort: AgentEffort;
  outputSchema?: AgentOutputSchema;
  readOnly: boolean;
  writableRoots: readonly string[];
  runtimeWritableRoots?: readonly string[];
  authorityConfigPath: string | undefined;
  env: Record<string, string> | undefined;
  resumeSessionId?: string;
  abortController?: AbortController;
  writer?: AgentHarnessWriter;
  onMessage?: (message: KotaAgentMessage) => void | Promise<void>;
  onProcessSpawn?: AgentHarnessRunOptions["onProcessSpawn"];
};

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
  try {
    ProcessSupervisor.notifySpawnedProcessGroup(child.pid, args.onProcessSpawn);
  } catch (error) {
    signalNativeCliProcessGroup(child, "SIGKILL");
    throw error;
  }

  const stderr: string[] = [];
  let spawnError: string | undefined;
  let parseError: string | undefined;

  const abort = (): void => {
    // AGY schedules work remotely. Give the CLI a chance to cancel that task
    // and emit its terminal result before the local process group closes.
    signalNativeCliProcessGroup(child, "SIGTERM");
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
    if (!output.hasTerminalResult) {
      const attempt = output.sessionId === undefined
        ? "the remote attempt"
        : `remote attempt ${output.sessionId}`;
      return {
        text:
          `Antigravity CLI stopped locally before ${attempt} reported a terminal result.`,
        streamedText: output.streamedText,
        ...(output.sessionId !== undefined ? { sessionId: output.sessionId } : {}),
        turns: output.turns,
        usage: unpricedAgentUsage(output.inputTokens, output.outputTokens),
        isError: true,
        subtype: ANTIGRAVITY_CLI_UNCONFIRMED_STOP_SUBTYPE,
      };
    }
    return {
      text: "Antigravity CLI run aborted.",
      streamedText: output.streamedText,
      ...(output.sessionId !== undefined ? { sessionId: output.sessionId } : {}),
      turns: output.turns,
      usage: unpricedAgentUsage(output.inputTokens, output.outputTokens),
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
      usage: unpricedAgentUsage(output.inputTokens, output.outputTokens),
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
      usage: unpricedAgentUsage(output.inputTokens, output.outputTokens),
      isError: true,
      subtype: isNativeCliSandboxBootstrapError(detail)
        ? "native_cli_sandbox_error"
        : "antigravity_cli_error",
    };
  }

  if (!output.hasTerminalResult) {
    return {
      text: "Antigravity CLI exited without a terminal result event.",
      streamedText: output.streamedText,
      ...(output.sessionId !== undefined ? { sessionId: output.sessionId } : {}),
      turns: output.turns,
      usage: unpricedAgentUsage(output.inputTokens, output.outputTokens),
      isError: true,
      subtype: "antigravity_cli_incomplete_output",
    };
  }

  const toolFailure = terminalToolFailure(output);
  if (toolFailure !== undefined) {
    return {
      text: toolFailure.detail,
      streamedText: output.streamedText,
      ...(output.sessionId !== undefined ? { sessionId: output.sessionId } : {}),
      turns: output.turns,
      usage: unpricedAgentUsage(output.inputTokens, output.outputTokens),
      isError: true,
      subtype: toolFailure.subtype,
    };
  }

  const text = output.structuredOutput === undefined
    ? output.responseText ?? output.streamedText
    : `\`\`\`json\n${JSON.stringify(output.structuredOutput)}\n\`\`\``;

  return {
    text,
    streamedText: output.streamedText,
    ...(output.sessionId !== undefined ? { sessionId: output.sessionId } : {}),
    turns: output.turns,
    usage: unpricedAgentUsage(output.inputTokens, output.outputTokens),
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
    ...(args.resumeSessionId === undefined
      ? ["--new-project"]
      : ["--conversation", args.resumeSessionId]),
    "--print",
    args.prompt,
    "--model",
    args.model,
    "--effort",
    resolveAntigravityCliEffort(args.effort),
    ...(args.outputSchema === undefined
      ? []
      : ["--json-schema", JSON.stringify(args.outputSchema)]),
    "--mode",
    args.readOnly ? "plan" : "accept-edits",
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
      machineAuthorityOwner: "kota",
      authorityConfigPath: args.authorityConfigPath,
      writableRoots: args.writableRoots,
      runtimeWritableRoots: args.runtimeWritableRoots,
      env: buildAntigravityCliEnvironment({
        inheritedEnv: process.env,
        overrides: args.env,
        keychainDirectory,
      }),
      readOnlyHostRoots: [],
      allowedEgressHosts: ANTIGRAVITY_CLI_PROVIDER_EGRESS_HOSTS,
      prepareEnvironment: prepareAntigravityCliRuntimeEnvironment,
    },
    (sandboxedProcess) =>
      runAntigravityCliProcess(args, sandboxedProcess),
  );
}
