import { spawn } from "node:child_process";
import type {
  AgentHarnessResult,
  AgentHarnessWriter,
} from "#core/agent-harness/index.js";
import { buildMachineAuthoritySandboxLaunch } from "#core/agent-harness/machine-authority-sandbox.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";

export const ANTIGRAVITY_CLI_BINARY_NAME = "agy";

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

export async function collectTextFromAntigravityCli(args: {
  prompt: string;
  cwd: string;
  model: string;
  passive: boolean;
  authorityConfigPath: string | undefined;
  env: Record<string, string> | undefined;
  abortController?: AbortController;
  writer?: AgentHarnessWriter;
}): Promise<AgentHarnessResult> {
  const cliArgs = [
    "--print",
    args.prompt,
    "--model",
    args.model,
    "--print-timeout",
    "5m",
    "--sandbox",
  ];

  const launch = buildMachineAuthoritySandboxLaunch(
    ANTIGRAVITY_CLI_BINARY_NAME,
    cliArgs,
    {
      cwd: args.cwd,
      authorityConfigPath: args.authorityConfigPath,
    },
  );
  if (!launch.ok) throw new Error(launch.error);

  const child = spawn(launch.command, launch.args, {
    cwd: args.cwd,
    env: withProtectedGitBareRepositoryEnv({
      ...process.env,
      ...(args.env ?? {}),
      NO_COLOR: "1",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdout: string[] = [];
  const stderr: string[] = [];
  let spawnError: string | undefined;

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

  const stdoutDone = new Promise<void>((resolve) => {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => stdout.push(chunk));
    child.stdout.on("end", resolve);
  });
  const stderrDone = new Promise<void>((resolve) => {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => stderr.push(chunk));
    child.stderr.on("end", resolve);
  });

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("error", (err) => {
      spawnError = err.message;
      resolve({ code: null, signal: null });
    });
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  removeAbortListener?.();
  await Promise.all([stdoutDone, stderrDone]);

  const text = stdout.join("").trim();
  if (args.abortController?.signal.aborted) {
    return {
      text: "Antigravity CLI run aborted.",
      streamedText: text,
      turns: text ? 1 : 0,
      isError: true,
      subtype: "aborted",
    };
  }

  if (spawnError !== undefined || exit.code !== 0) {
    const detail =
      spawnError ??
      (formatStderr(stderr) ||
        `Antigravity CLI exited with code ${exit.code ?? `signal ${exit.signal}`}`);
    return {
      text: detail,
      streamedText: text,
      turns: text ? 1 : 0,
      isError: true,
      subtype: "antigravity_cli_error",
    };
  }

  if (!text) {
    return {
      text: "Antigravity CLI completed without output.",
      streamedText: "",
      turns: 0,
      isError: true,
      subtype: "antigravity_cli_empty_output",
    };
  }

  args.writer?.write(text);
  return {
    text,
    streamedText: text,
    turns: 1,
    isError: false,
  };
}
