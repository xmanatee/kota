import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type {
  AgentEffort,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
  KotaAgentMessage,
} from "#core/agent-harness/index.js";
import { buildMachineAuthoritySandboxLaunch } from "#core/agent-harness/machine-authority-sandbox.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";

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
    type?: string;
    text?: string;
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
  const env = withProtectedGitBareRepositoryEnv({
    ...process.env,
    ...(overrides ?? {}),
  });
  delete env.OPENAI_API_KEY;
  return env;
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

export async function collectTextFromCodexCli(args: {
  prompt: string;
  cwd: string;
  model: string;
  effort: AgentEffort;
  sandbox: "read-only" | "workspace-write";
  authorityConfigPath: string | undefined;
  env: Record<string, string> | undefined;
  abortController: AbortController | undefined;
  writer: AgentHarnessWriter | undefined;
  onMessage: AgentHarnessRunOptions["onMessage"] | undefined;
}): Promise<AgentHarnessResult> {
  const cliArgs = [
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--strict-config",
    "--disable",
    "plugins",
    "--disable",
    "hooks",
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
    `model_reasoning_effort="${mapEffortToCodexReasoning(args.effort)}"`,
    "-c",
    'approval_policy="never"',
    "-",
  ];

  const launch = buildMachineAuthoritySandboxLaunch("codex", cliArgs, {
    cwd: args.cwd,
    authorityConfigPath: args.authorityConfigPath,
  });
  if (!launch.ok) throw new Error(launch.error);

  const child = spawn(launch.command, launch.args, {
    cwd: args.cwd,
    env: buildCodexEnvironment(args.env),
    stdio: ["pipe", "pipe", "pipe"],
  });

  const stderr: string[] = [];
  const streamedChunks: string[] = [];
  let sessionId: string | undefined;
  let turns = 0;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let cliError: string | undefined;

  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  const clearForceKill = (): void => {
    if (forceKillTimer === undefined) return;
    clearTimeout(forceKillTimer);
    forceKillTimer = undefined;
  };
  const sendSignal = (signal: NodeJS.Signals): void => {
    if (child.exitCode === null) child.kill(signal);
  };
  const terminateChild = (): void => {
    sendSignal("SIGTERM");
    if (forceKillTimer !== undefined) return;
    forceKillTimer = setTimeout(() => {
      if (child.exitCode === null) sendSignal("SIGKILL");
    }, CODEX_ABORT_FORCE_KILL_MS);
    forceKillTimer.unref?.();
  };
  let removeAbortListener: (() => void) | undefined;
  const abortController = args.abortController;
  if (abortController) {
    if (abortController.signal.aborted) terminateChild();
    else {
      abortController.signal.addEventListener("abort", terminateChild, {
        once: true,
      });
      removeAbortListener = () =>
        abortController.signal.removeEventListener("abort", terminateChild);
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
        await emitCodexMessage(
          args.onMessage,
          withSession(
            {
              type: "result",
              isError: false,
              numTurns: turns,
              ...(inputTokens !== undefined ? { inputTokens } : {}),
              ...(outputTokens !== undefined ? { outputTokens } : {}),
            },
            sessionId,
          ),
        );
      } else if (event.type === "error") {
        cliError = event.message ?? "Codex CLI reported an error";
        await emitCodexMessage(
          args.onMessage,
          withSession(
            {
              type: "result",
              isError: true,
              subtype: "codex_cli_error",
              text: cliError,
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

  if (abortController?.signal.aborted) {
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
