import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type {
  AgentHarnessResult,
  AgentHarnessWriter,
} from "#core/agent-harness/index.js";
import { buildMachineAuthoritySandboxLaunch } from "#core/agent-harness/machine-authority-sandbox.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import {
  type CollectedGeminiOutput,
  collectGeminiOutput,
  emptyCollectedGeminiOutput,
} from "./cli-output.js";

export type GeminiCliApprovalMode = "default" | "plan";

function formatStderr(stderr: string[]): string {
  return stderr.join("").trim();
}

export async function collectTextFromGeminiCli(args: {
  prompt: string;
  cwd: string;
  model: string;
  approvalMode: GeminiCliApprovalMode;
  authorityConfigPath: string | undefined;
  env: Record<string, string> | undefined;
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
    "--sandbox",
  ];

  const launch = buildMachineAuthoritySandboxLaunch("gemini", cliArgs, {
    cwd: args.cwd,
    authorityConfigPath: args.authorityConfigPath,
  });
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
    child.kill("SIGTERM");
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
