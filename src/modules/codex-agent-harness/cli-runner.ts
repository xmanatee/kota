import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { globSync } from "glob";
import type {
  AgentEffort,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
  KotaAgentMessage,
} from "#core/agent-harness/index.js";
import { NATIVE_CLI_EGRESS_UPSTREAM_PROXY_ENV } from "#core/agent-harness/native-cli-egress-proxy.js";
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
import { SessionRecoveryError } from "#core/agent-harness/session-continuity.js";
import { unpricedAgentUsage } from "#core/agent-harness/usage.js";
import { ProcessSupervisor } from "#core/execution/process-supervisor.js";
import { CODEX_PROVIDER_EGRESS_ENDPOINTS } from "./provider-egress.js";
import { prepareCodexRuntimeEnvironment } from "./runtime-home.js";

const CODEX_ABORT_FORCE_KILL_MS = 5_000;


type CodexCliUsage = {
  input_tokens?: number;
  output_tokens?: number;
};

type CodexCliEvent = {
  type?: string;
  thread_id?: string;
  usage?: CodexCliUsage;
  item?: {
    id?: string;
    type?: string;
    text?: string;
    command?: string;
    query?: string;
    aggregated_output?: string;
    exit_code?: number;
    status?: string;
  };
  message?: string;
};

function mapEffortToCodexReasoning(
  effort: AgentEffort,
): "low" | "medium" | "high" | "xhigh" | "max" {
  if (effort === "low") return "low";
  if (effort === "medium") return "medium";
  if (effort === "high") return "high";
  return effort;
}

function buildCodexEnvironment(
  overrides: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  return buildNativeCliEnvironment({
    overrides,
    projectedEnvKeys: ["CODEX_HOME", NATIVE_CLI_EGRESS_UPSTREAM_PROXY_ENV],
    blockedEnvKeys: ["OPENAI_API_KEY"],
  });
}

function parseCodexEvent(line: string): CodexCliEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: CodexCliEvent;
  try {
    parsed = JSON.parse(trimmed) as CodexCliEvent;
  } catch {
    throw new Error(`Codex CLI emitted non-JSON output in json mode: ${trimmed}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Codex CLI emitted non-object JSON event: ${trimmed}`);
  }
  return parsed;
}

function formatStderr(stderr: string[]): string {
  return stderr.join("").trim();
}

async function emitCodexMessage(
  onMessage: AgentHarnessRunOptions["onMessage"] | undefined,
  message: KotaAgentMessage,
): Promise<void> {
  if (onMessage !== undefined) await onMessage(message);
}

function withSession(
  message: KotaAgentMessage,
  sessionId: string | undefined,
): KotaAgentMessage {
  return sessionId === undefined ? message : { ...message, sessionId };
}

type CollectTextFromCodexCliArgs = {
  sessionStorageDir?: string;
  persistSession?: boolean;
  resumeSessionId?: string;
  onSessionId?: (id: string) => void;
  prompt: string;
  cwd: string;
  scopeRoot?: string;
  model: string;
  effort: AgentEffort;
  webSearch: boolean;
  writableRoots: readonly string[];
  runtimeWritableRoots?: readonly string[];
  readOnlyHostRoots: readonly string[];
  authorityConfigPath: string | undefined;
  env: Record<string, string> | undefined;
  abortController: AbortController | undefined;
  writer: AgentHarnessWriter | undefined;
  onMessage: AgentHarnessRunOptions["onMessage"] | undefined;
  onUsage: AgentHarnessRunOptions["onUsage"] | undefined;
  onProcessSpawn: AgentHarnessRunOptions["onProcessSpawn"] | undefined;
};

async function runCodexCliProcess(
  args: CollectTextFromCodexCliArgs,
  sandboxedProcess: NativeCliSandboxProcess,
): Promise<AgentHarnessResult> {
  const child = spawn(sandboxedProcess.command, sandboxedProcess.args, {
    cwd: args.cwd,
    env: sandboxedProcess.env,
    ...NATIVE_CLI_PROCESS_GROUP_SPAWN_OPTIONS,
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    ProcessSupervisor.notifySpawnedProcessGroup(child.pid, args.onProcessSpawn);
  } catch (error) {
    signalNativeCliProcessGroup(child, "SIGKILL");
    throw error;
  }

  const stderr: string[] = [];
  const streamedChunks: string[] = [];
  let sessionId: string | undefined;
  let turns = 0;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let commandSequence = 0;
  let cliFailure: { detail: string; subtype: string } | undefined;
  let processFailure: Error | undefined;

  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  const clearForceKill = (): void => {
    if (forceKillTimer === undefined) return;
    clearTimeout(forceKillTimer);
    forceKillTimer = undefined;
  };
  const sendSignal = (signal: NodeJS.Signals): void => {
    try {
      signalNativeCliProcessGroup(child, signal);
    } catch (error) {
      processFailure ??= new Error(`Codex CLI ${signal} failed: ${String(error)}`, { cause: error });
      // Timer/abort callbacks cannot throw. Keep quarantine until actual close.
      void emitCodexMessage(args.onMessage, withSession({
        type: "status",
        category: "codex.termination.failed",
        text: processFailure.message,
      }, sessionId)).catch((callbackError: unknown) => {
        processFailure = new AggregateError(
          [processFailure, callbackError], "Codex CLI termination and diagnostic delivery failed",
        );
      });
    }
  };
  const terminateChild = (): void => {
    sendSignal("SIGTERM");
    if (forceKillTimer !== undefined) return;
    forceKillTimer = setTimeout(() => {
      sendSignal("SIGKILL");
    }, CODEX_ABORT_FORCE_KILL_MS);
    forceKillTimer.unref?.();
  };
  const quarantineChild = (): void => {
    sendSignal("SIGKILL");
  };
  let removeAbortListener: (() => void) | undefined;
  const abortController = args.abortController;
  if (abortController) {
    if (abortController.signal.aborted) quarantineChild();
    else {
      abortController.signal.addEventListener("abort", quarantineChild, {
        once: true,
      });
      removeAbortListener = () =>
        abortController.signal.removeEventListener("abort", quarantineChild);
    }
  }

  child.stdin.end(args.prompt);

  const stderrDone = new Promise<void>((resolve) => {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => stderr.push(chunk));
    child.stderr.on("end", resolve);
  });

  const stdoutDone = (async (): Promise<void> => {
    try {
      const lines = createInterface({ input: child.stdout });
      for await (const line of lines) {
        const event = parseCodexEvent(line);
        if (!event) continue;
        if (event.type === "thread.started" && typeof event.thread_id === "string") {
          sessionId = event.thread_id;
          args.onSessionId?.(sessionId);
          await emitCodexMessage(args.onMessage, {
            type: "status",
            category: "codex.thread.started",
            sessionId,
            text: "Codex thread started.",
          });
        } else if (event.type === "turn.started") {
          await emitCodexMessage(
            args.onMessage,
            withSession(
              {
                type: "status",
                category: "codex.turn.started",
                text: "Codex turn started.",
              },
              sessionId,
            ),
          );
        } else if (
          event.type === "item.completed" &&
          event.item?.type === "command_execution" &&
          typeof event.item.command === "string"
        ) {
          commandSequence += 1;
          const toolUseId = event.item.id ?? `codex-command-${commandSequence}`;
          await emitCodexMessage(
            args.onMessage,
            withSession({
              type: "tool_call",
              toolUseId,
              toolName: "codex.command",
              input: { command: event.item.command },
            }, sessionId),
          );
          await emitCodexMessage(
            args.onMessage,
            withSession({
              type: "tool_result",
              toolUseId,
              isError:
                (event.item.exit_code !== undefined && event.item.exit_code !== 0) ||
                event.item.status === "failed",
              content: event.item.aggregated_output ?? "",
            }, sessionId),
          );
        } else if (event.type === "item.completed" && event.item?.type === "web_search") {
          const toolUseId = event.item.id ?? `web-search-${++commandSequence}`;
          await emitCodexMessage(args.onMessage, withSession({
            type: "tool_call",
            toolName: "codex.web_search",
            toolUseId,
            input: { query: event.item.query ?? "" },
          }, sessionId));
          await emitCodexMessage(args.onMessage, withSession({
            type: "tool_result",
            toolUseId,
            isError: false,
            content: "Native web search completed. Codex CLI does not expose the result body in this event.",
          }, sessionId));
        } else if (event.type === "item.completed" && event.item?.type === "agent_message") {
          const text = event.item.text ?? "";
          streamedChunks.push(text);
          args.writer?.write(text);
          await emitCodexMessage(
            args.onMessage,
            withSession({ type: "text", text }, sessionId),
          );
        } else if (event.type === "turn.completed") {
          turns += 1;
          inputTokens = event.usage?.input_tokens;
          outputTokens = event.usage?.output_tokens;
          const usage = unpricedAgentUsage(inputTokens, outputTokens);
          args.onUsage?.(usage);
          await emitCodexMessage(
            args.onMessage,
            withSession(
              {
                type: "result",
                isError: false,
                numTurns: turns,
                usage,
              },
              sessionId,
            ),
          );
        } else if (event.type === "error") {
          cliFailure = {
            detail: event.message ?? "Codex CLI reported an error",
            subtype: "codex_cli_error",
          };
          await emitCodexMessage(
            args.onMessage,
            withSession(
              {
                type: "result",
                isError: true,
                subtype: cliFailure.subtype,
                text: cliFailure.detail,
                usage: unpricedAgentUsage(undefined, undefined),
              },
              sessionId,
            ),
          );
          terminateChild();
          return;
        } else if (event.type !== undefined) {
          await emitCodexMessage(
            args.onMessage,
            withSession(
              {
                type: "status",
                category: `codex.${event.type}`,
                ...(typeof event.message === "string" ? { text: event.message } : {}),
              },
              sessionId,
            ),
          );
        }
      }
    } catch (error) {
      processFailure ??= error instanceof Error ? error : new Error(String(error));
      quarantineChild();
    }
  })();

  const clearAbortHandlers = (): void => {
    removeAbortListener?.();
    clearForceKill();
  };
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.on("error", (error) => {
      clearAbortHandlers();
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearAbortHandlers();
      resolve({ code, signal });
    });
  });
  await Promise.all([stdoutDone, stderrDone]);
  if (processFailure !== undefined) throw processFailure;

  if (abortController?.signal.aborted) {
    return {
      text: "Codex CLI run aborted.",
      streamedText: streamedChunks.join(""),
      ...(sessionId !== undefined ? { sessionId } : {}),
      turns,
      usage: unpricedAgentUsage(inputTokens, outputTokens),
      isError: true,
      subtype: "aborted",
    };
  }

  if (exit.code !== 0 || cliFailure !== undefined) {
    const detail =
      cliFailure?.detail ??
      (formatStderr(stderr) ||
        `Codex CLI exited with code ${exit.code ?? `signal ${exit.signal}`}`);
    return {
      text: detail,
      streamedText: streamedChunks.join(""),
      ...(sessionId !== undefined ? { sessionId } : {}),
      turns,
      usage: unpricedAgentUsage(inputTokens, outputTokens),
      isError: true,
      subtype: cliFailure?.subtype ?? (
        isNativeCliSandboxBootstrapError(detail)
          ? "native_cli_sandbox_error"
          : "codex_cli_error"
      ),
    };
  }

  return {
    text: streamedChunks.join(""),
    streamedText: streamedChunks.join(""),
    ...(sessionId !== undefined ? { sessionId } : {}),
    turns: turns || (streamedChunks.length > 0 ? 1 : 0),
    usage: unpricedAgentUsage(inputTokens, outputTokens),
    isError: false,
  };
}

export async function collectTextFromCodexCli(
  args: CollectTextFromCodexCliArgs,
): Promise<AgentHarnessResult> {
  if (args.resumeSessionId !== undefined) {
    if (!/^[0-9a-f-]{36}$/i.test(args.resumeSessionId)) throw new Error("Codex resume requires an explicit thread UUID.");
    if (args.sessionStorageDir === undefined) throw new SessionRecoveryError("No owned Codex conversation storage is available. Previously ephemeral histories cannot be reconstructed.");
    const files = globSync(["sessions/**/rollout-*.jsonl", "archived_sessions/**/rollout-*.jsonl"], { cwd: args.sessionStorageDir });
    const rollout = files.find((file) => file.endsWith(`-${args.resumeSessionId}.jsonl`));
    if (rollout === undefined) throw new SessionRecoveryError("The owned Codex rollout is missing; saved workspace and run evidence remain available.");
    const source = readFileSync(join(args.sessionStorageDir, rollout), "utf8");
    try {
      const first: unknown = JSON.parse(source.split("\n")[0] ?? "");
      if (typeof first !== "object" || first === null || !("type" in first) || first.type !== "session_meta" || !("payload" in first) || typeof first.payload !== "object" || first.payload === null || !("id" in first.payload) || first.payload.id !== args.resumeSessionId) throw new Error("Missing or mismatched rollout metadata");
    } catch { throw new SessionRecoveryError("The owned Codex rollout metadata is corrupt; the original file was retained."); }
  }
  const cliArgs = [
    "exec",
    ...(args.resumeSessionId === undefined ? [] : ["resume", args.resumeSessionId]),
    "--json",
    ...(args.persistSession === false ? ["--ephemeral"] : []),
    "--strict-config",
    "--disable",
    "plugins",
    "--disable",
    "hooks",
    "--model",
    args.model,
    "--skip-git-repo-check",
    "-c",
    `model_reasoning_effort="${mapEffortToCodexReasoning(args.effort)}"`,
    "-",
  ];
  return withNativeCliSandbox(
    "codex",
    cliArgs,
    {
      cwd: args.cwd,
      scopeRoot: args.scopeRoot,
      machineAuthorityOwner: "native-cli",
      authorityConfigPath: args.authorityConfigPath,
      writableRoots: args.writableRoots,
      runtimeWritableRoots: args.runtimeWritableRoots,
      readOnlyHostRoots: args.readOnlyHostRoots,
      env: buildCodexEnvironment(args.env),
      allowedEgressHosts: CODEX_PROVIDER_EGRESS_ENDPOINTS.map((endpoint) => endpoint.host),
      prepareEnvironment: (context, env) => prepareCodexRuntimeEnvironment(
        context, env, args.persistSession === false ? undefined : args.sessionStorageDir, args.webSearch,
      ),
    },
    (sandboxedProcess) => runCodexCliProcess(args, sandboxedProcess),
  );
}
