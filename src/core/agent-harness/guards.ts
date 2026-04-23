/**
 * Harness-neutral `canUseTool` guards and composition helpers.
 *
 * Each guard reads tool inputs (Bash commands, tool names) and returns a
 * `PermissionResult`. Every registered adapter honors `canUseTool`, so these
 * guards apply uniformly across claude-agent-sdk, openai-tools, and any
 * future adapter that runs a tool loop. Callers compose the guards they need
 * (commit-blocking, daemon-host control) and hand the composed callback to
 * `runAgentHarness` through the neutral `canUseTool` option.
 */

import type { AgentCanUseTool, AgentPermissionResult } from "./types.js";

const COMMIT_DENIAL_MESSAGE =
  "Workflow agents must not run `git commit`. Stage changes with `git add` and write `<run-dir>/commit-message.txt`; the workflow's commit step creates the commit after validation gates pass.";

const DAEMON_DENIAL_MESSAGE =
  "Workflow agents must not control, stop, restart, or signal the daemon process that hosts them.";

const CONTROLLED_WORKFLOW_COMMANDS = new Set([
  "abort",
  "pause",
  "reload",
  "resume",
  "retry",
  "trigger",
]);

function normalizeCommand(command: string): string {
  return command.replace(/\\\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

// Matches a `git ... commit` subcommand as a standalone token anywhere in a
// shell command. Flag tokens (`-C path`, `--no-verify`, single-char flags) and
// short arguments like `-C /tmp` are skipped. `commit` must appear as its own
// word followed by end-of-command, whitespace, or a shell separator so tokens
// like `my-commit` or `git-commit-tree` do not trigger.
const GIT_COMMIT_PATTERN =
  /(?:^|[\s;&|()`])git\s+(?:(?:-\S+|--\S+|[^\s;&|()-][^\s;&|()]*)\s+)*commit(?=$|\s|[;&|()`])/;

export function isGitCommitCommand(command: string): boolean {
  const normalized = normalizeCommand(command);
  if (!normalized) return false;
  return GIT_COMMIT_PATTERN.test(normalized);
}

export function createAgentCommitGuard(): AgentCanUseTool {
  return async (toolName, input): Promise<AgentPermissionResult> => {
    if (toolName !== "Bash") return { behavior: "allow", updatedInput: input };
    const command = typeof input.command === "string" ? input.command : "";
    if (!isGitCommitCommand(command)) {
      return { behavior: "allow", updatedInput: input };
    }
    // Deny without `interrupt: true`: the claude SDK translates `interrupt`
    // into `abortController.abort()`, which tears down the entire session.
    // Both adapters that honor `canUseTool` treat a bare `deny` as "block
    // this call and feed the denial back as a tool_result", which lets the
    // agent adapt instead of losing the run.
    return {
      behavior: "deny",
      message: COMMIT_DENIAL_MESSAGE,
      decisionClassification: "user_reject",
    };
  };
}

function hasKotaCommand(command: string, area: "daemon" | "workflow", action?: string): boolean {
  const escapedAction = action ? `\\s+${action}` : "";
  const direct = new RegExp(`(?:^|[\\s;&|()])(?:\\./)?kota\\s+${area}${escapedAction}(?=$|[\\s;&|()])`);
  const pnpm = new RegExp(`(?:^|[\\s;&|()])pnpm\\s+(?:exec\\s+)?kota\\s+${area}${escapedAction}(?=$|[\\s;&|()])`);
  const node = new RegExp(
    `(?:^|[\\s;&|()])node\\s+\\S*(?:bin/kota\\.mjs|dist/cli\\.js)\\s+${area}${escapedAction}(?=$|[\\s;&|()])`,
  );
  return direct.test(command) || pnpm.test(command) || node.test(command);
}

export function isDaemonHostControlCommand(command: string, daemonPid = process.pid): boolean {
  const normalized = normalizeCommand(command);
  if (!normalized) return false;

  if (hasKotaCommand(normalized, "daemon")) return true;
  for (const action of CONTROLLED_WORKFLOW_COMMANDS) {
    if (hasKotaCommand(normalized, "workflow", action)) return true;
  }

  const pid = String(daemonPid);
  const killCurrentPid = new RegExp(`(?:^|[\\s;&|()])kill\\b(?=[^;&|()]*\\b${pid}\\b)[^;&|()]*`);
  if (killCurrentPid.test(normalized)) return true;

  return /(?:^|[\s;&|()])(?:pkill|killall)\b.*(?:dist\/cli\.js daemon|bin\/kota\.mjs daemon|\bkota daemon\b)/.test(normalized);
}

export function createDaemonHostControlGuard(daemonPid = process.pid): AgentCanUseTool {
  return async (toolName, input): Promise<AgentPermissionResult> => {
    if (toolName !== "Bash") return { behavior: "allow", updatedInput: input };
    const command = typeof input.command === "string" ? input.command : "";
    if (!isDaemonHostControlCommand(command, daemonPid)) {
      return { behavior: "allow", updatedInput: input };
    }
    return {
      behavior: "deny",
      message: DAEMON_DENIAL_MESSAGE,
      decisionClassification: "user_reject",
    };
  };
}

// Runs each guard in order. The first `deny` result short-circuits; otherwise
// all guards agree and we allow with the final input. If a guard returns
// `allow` with an `updatedInput`, that updated input is threaded through to
// subsequent guards so they see the rewritten form.
export function composeCanUseTools(
  ...guards: AgentCanUseTool[]
): AgentCanUseTool {
  return async (toolName, input, opts): Promise<AgentPermissionResult> => {
    let currentInput = input;
    for (const guard of guards) {
      const result = await guard(toolName, currentInput, opts);
      if (result.behavior === "deny") return result;
      if (
        result.behavior === "allow" &&
        typeof result.updatedInput === "object" &&
        result.updatedInput !== null
      ) {
        currentInput = result.updatedInput as typeof input;
      }
    }
    return { behavior: "allow", updatedInput: currentInput };
  };
}

/**
 * Standard guard stack applied to every workflow / autonomy agent run:
 * blocks `git commit` (the workflow commit step owns that) and denies calls
 * that would stop or restart the daemon hosting the agent.
 */
export function createWorkflowAgentGuards(): AgentCanUseTool {
  return composeCanUseTools(
    createDaemonHostControlGuard(),
    createAgentCommitGuard(),
  );
}
