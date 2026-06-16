/**
 * Harness-neutral `canUseTool` guards and composition helpers.
 *
 * Each guard reads tool inputs (Bash commands, tool names) and returns a
 * `PermissionResult`. Adapters with a KOTA-routable tool loop honor
 * `canUseTool`; adapters that cannot must declare it unsupported so
 * `runAgentHarness` rejects guarded calls before launch. Callers compose the
 * guards they need (commit-blocking, daemon-host control) and hand the
 * composed callback to `runAgentHarness` through the neutral `canUseTool`
 * option.
 */

import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { AgentCanUseTool, AgentPermissionResult } from "./types.js";

type AgentToolInput = Parameters<AgentCanUseTool>[1];

const COMMIT_DENIAL_MESSAGE =
  "Workflow agents must not run `git commit`. Stage changes with `git add` and write `<run-dir>/commit-message.txt`; the workflow's commit step creates the commit after validation gates pass.";

const DAEMON_DENIAL_MESSAGE =
  "Workflow agents must not control, stop, restart, or signal the daemon process that hosts them.";

const PACKAGE_BOOTSTRAP_DENIAL_MESSAGE =
  "Workflow agents must not install package managers or dependencies unless the project explicitly opts in with `.kota/allow-package-bootstrap`. Inspect the existing files and make the requested direct change.";

const PACKAGE_PROJECT_MARKERS = [
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
] as const;

const PACKAGE_BOOTSTRAP_ALLOW_MARKER = ".kota/allow-package-bootstrap";

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

function isShellCommandTool(toolName: string): boolean {
  return toolName === "Bash" || toolName === "shell";
}

function commandWorkingDirectory(input: AgentToolInput): string {
  const cwd = typeof input.cwd === "string" && input.cwd.trim() ? input.cwd.trim() : process.cwd();
  return isAbsolute(cwd) ? cwd : resolve(process.cwd(), cwd);
}

function hasPackageProjectMarker(startDir: string): boolean {
  let current = resolve(startDir);
  while (true) {
    if (PACKAGE_PROJECT_MARKERS.some((marker) => existsSync(join(current, marker)))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function hasPackageBootstrapAllowMarker(startDir: string): boolean {
  let current = resolve(startDir);
  while (true) {
    if (existsSync(join(current, PACKAGE_BOOTSTRAP_ALLOW_MARKER))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
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
    if (!isShellCommandTool(toolName)) return { behavior: "allow", updatedInput: input };
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
      decisionAttribution: "operator-deny",
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
    if (!isShellCommandTool(toolName)) return { behavior: "allow", updatedInput: input };
    const command = typeof input.command === "string" ? input.command : "";
    if (!isDaemonHostControlCommand(command, daemonPid)) {
      return { behavior: "allow", updatedInput: input };
    }
    return {
      behavior: "deny",
      message: DAEMON_DENIAL_MESSAGE,
      decisionAttribution: "operator-deny",
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

export function isPackageBootstrapCommand(command: string): boolean {
  const normalized = normalizeCommand(command);
  if (!normalized) return false;
  return /(?:^|[\s;&|()])(?:npm\s+(?:install|i)\b|pnpm\s+(?:install|i)\b|yarn\s+(?:install|add)\b|bun\s+install\b|corepack\s+(?:enable|prepare|use)\b)(?=$|[\s;&|()])/.test(
    normalized,
  );
}

export function createPackageBootstrapGuard(): AgentCanUseTool {
  return async (toolName, input): Promise<AgentPermissionResult> => {
    if (!isShellCommandTool(toolName)) return { behavior: "allow", updatedInput: input };
    const command = typeof input.command === "string" ? input.command : "";
    if (!isPackageBootstrapCommand(command)) {
      return { behavior: "allow", updatedInput: input };
    }
    const cwd = commandWorkingDirectory(input);
    if (hasPackageProjectMarker(cwd) && hasPackageBootstrapAllowMarker(cwd)) {
      return { behavior: "allow", updatedInput: input };
    }
    return {
      behavior: "deny",
      message: PACKAGE_BOOTSTRAP_DENIAL_MESSAGE,
      decisionAttribution: "operator-deny",
    };
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
    createPackageBootstrapGuard(),
  );
}
