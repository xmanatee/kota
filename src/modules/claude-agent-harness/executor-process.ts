import { spawn, spawnSync } from "node:child_process";
import type { SpawnedProcess, SpawnOptions } from "@anthropic-ai/claude-agent-sdk";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";

export const SDK_ABORT_FORCE_KILL_MS = 10_000;

export function detectLocalClaudeCodeExecutable(): string | undefined {
  const explicit = process.env.CLAUDE_CODE_EXECUTABLE?.trim();
  if (explicit) return explicit;

  const lookupCommand = process.platform === "win32" ? "where" : "which";
  for (const command of ["claude", "claude-code"]) {
    const result = spawnSync(lookupCommand, [command], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result?.status === 0) {
      const candidate = result.stdout.trim();
      if (candidate) return candidate;
    }
  }

  return undefined;
}

export function spawnClaudeCodeProcessWithAbortKill(
  options: SpawnOptions,
): SpawnedProcess {
  const stderrMode: "pipe" | "ignore" = options.env.DEBUG_CLAUDE_AGENT_SDK
    ? "pipe"
    : "ignore";
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: withProtectedGitBareRepositoryEnv(options.env as NodeJS.ProcessEnv),
    signal: options.signal,
    stdio: ["pipe", "pipe", stderrMode],
    windowsHide: true,
  });

  if (child.stderr) {
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  }

  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  const clearForceKill = () => {
    if (forceKillTimer) {
      clearTimeout(forceKillTimer);
      forceKillTimer = undefined;
    }
    options.signal.removeEventListener("abort", scheduleForceKill);
  };
  const scheduleForceKill = () => {
    if (forceKillTimer) return;
    forceKillTimer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, SDK_ABORT_FORCE_KILL_MS);
    forceKillTimer.unref();
  };

  if (options.signal.aborted) scheduleForceKill();
  else options.signal.addEventListener("abort", scheduleForceKill, { once: true });
  child.once("exit", clearForceKill);
  child.once("error", clearForceKill);

  return child as SpawnedProcess;
}
