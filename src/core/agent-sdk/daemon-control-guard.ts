import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";

const DENIAL_MESSAGE =
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

export function createDaemonHostControlGuard(daemonPid = process.pid): CanUseTool {
  return async (toolName, input): Promise<PermissionResult> => {
    if (toolName !== "Bash") return { behavior: "allow", updatedInput: input };
    const command = typeof input.command === "string" ? input.command : "";
    if (!isDaemonHostControlCommand(command, daemonPid)) {
      return { behavior: "allow", updatedInput: input };
    }
    // See agent-commit-guard.ts: `interrupt: true` aborts the whole SDK
    // session via `abortController.abort()`, so a single denied command
    // would kill the entire workflow. `deny` alone blocks the command and
    // lets the agent see the denial in a tool_result and course-correct.
    return {
      behavior: "deny",
      message: DENIAL_MESSAGE,
      decisionClassification: "user_reject",
    };
  };
}
