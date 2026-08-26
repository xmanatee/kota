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

import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import {
  isScopeAuthorityOperatorTokenPath,
  scopeAuthorityOperatorTokenPaths,
} from "#core/daemon/scope-authority-operator-token.js";
import {
  classifyWorkflowShellTeardownCommand,
  hasPackageBootstrapAllowMarker,
  hasPackageProjectMarker,
  isGitMetadataMutationCommand,
  isPackageBootstrapCommand,
  normalizeCommand,
} from "./guard-command-classifiers.js";
import type { AgentCanUseTool, AgentPermissionResult } from "./types.js";

export {
  classifyWorkflowShellTeardownCommand,
  isGitCommitCommand,
  isGitMetadataMutationCommand,
  isPackageBootstrapCommand,
} from "./guard-command-classifiers.js";

type AgentToolInput = Parameters<AgentCanUseTool>[1];

const GIT_OWNERSHIP_DENIAL_MESSAGE =
  "Workflow agents must not run git add, git commit, mutate branches, push, or amend workflow-owned commits. Leave workspace changes unstaged and write `<run-dir>/commit-message.txt`; the workflow runtime owns Git metadata and commits after validation gates pass.";

const DAEMON_DENIAL_MESSAGE =
  "Workflow agents must not control, stop, restart, or signal the daemon process that hosts them.";

const SCOPE_AUTHORITY_DENIAL_MESSAGE =
  "Workflow agents cannot mutate machine-owned scope trust or policy. Only an interactive operator client may apply authority changes.";

const SCOPE_AUTHORITY_TOKEN_DENIAL_MESSAGE =
  "Workflow agents cannot read or manipulate the machine-owned scope authority operator token.";

const LOCAL_WORK_TEARDOWN_DENIAL_MESSAGE =
  "Workflow agents cannot discard local work from inside an autonomous run. Inspect, edit, or stage files instead of running destructive Git teardown commands.";

const INFRASTRUCTURE_DESTROY_DENIAL_MESSAGE =
  "Workflow agents cannot destroy infrastructure from inside an autonomous run. Infrastructure teardown requires an explicit operator-owned action outside the workflow agent shell.";

const PACKAGE_BOOTSTRAP_DENIAL_MESSAGE =
  "Workflow agents must not install package managers or dependencies unless the project explicitly opts in with `.kota/allow-package-bootstrap`. Inspect the existing files and make the requested direct change.";

const WORKFLOW_NESTING_DENIAL_MESSAGE =
  "Workflow agents must not launch hidden subagents or create scratch worktrees. Use the workflow's declared agent step and workspace so ownership, limits, and recovery remain enforceable.";

const WORKFLOW_NESTING_TOOLS = new Set([
  "Agent",
  "Task",
  "EnterWorktree",
  "ExitWorktree",
]);

const CONTROLLED_WORKFLOW_COMMANDS = new Set([
  "abort",
  "pause",
  "reload",
  "resume",
  "retry",
  "trigger",
]);

function isShellCommandTool(toolName: string): boolean {
  return toolName === "Bash" || toolName === "shell";
}

function commandWorkingDirectory(input: AgentToolInput): string {
  const cwd = typeof input.cwd === "string" && input.cwd.trim() ? input.cwd.trim() : process.cwd();
  return isAbsolute(cwd) ? cwd : resolve(process.cwd(), cwd);
}

const RUNTIME_OWNED_GIT_TOOL_OPERATIONS = new Set([
  "add",
  "branch",
  "commit",
  "push",
]);

/** Keeps Git metadata and publication under the workflow runtime's ownership. */
export function createWorkflowGitOwnershipGuard(): AgentCanUseTool {
  return async (toolName, input): Promise<AgentPermissionResult> => {
    const shellMutation = isShellCommandTool(toolName) &&
      isGitMetadataMutationCommand(typeof input.command === "string" ? input.command : "");
    const routedGitMutation = toolName === "git" &&
      typeof input.op === "string" &&
      RUNTIME_OWNED_GIT_TOOL_OPERATIONS.has(input.op);
    if (!shellMutation && !routedGitMutation) {
      return { behavior: "allow", updatedInput: input };
    }
    // Deny without `interrupt: true`: the claude SDK translates `interrupt`
    // into `abortController.abort()`, which tears down the entire session.
    // Both adapters that honor `canUseTool` treat a bare `deny` as "block
    // this call and feed the denial back as a tool_result", which lets the
    // agent adapt instead of losing the run.
    return {
      behavior: "deny",
      message: GIT_OWNERSHIP_DENIAL_MESSAGE,
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

function hasScopeAuthorityMutationCommand(command: string): boolean {
  const commandPatterns = [
    /(?:^|[\s;&|()])(?:\.\/)?kota\s+project\s+authority\s+set(?=$|[\s;&|()])/,
    /(?:^|[\s;&|()])pnpm\s+(?:exec\s+)?kota\s+project\s+authority\s+set(?=$|[\s;&|()])/,
    /(?:^|[\s;&|()])node\s+\S*(?:bin\/kota\.mjs|dist\/cli\.js)\s+project\s+authority\s+set(?=$|[\s;&|()])/,
  ];
  if (commandPatterns.some((pattern) => pattern.test(command))) return true;

  const authorityRoute = /\/scopes\/[^\s'"?]+\/authority(?:[\s?'";]|$)/;
  if (!authorityRoute.test(command)) return false;
  return /(?:^|[\s;&|()])(?:curl|http|httpie|wget)\b/.test(command) ||
    /\b(?:fetch|request)\s*\(/.test(command);
}

function inputText(input: AgentToolInput): string {
  return JSON.stringify(input).toLowerCase();
}

function expandHomeReferences(text: string): string {
  const home = homedir();
  return text
    .replace(/(^|[^A-Za-z0-9_])~(?=\/)/g, `$1${home}`)
    .replace(/\$(?:HOME|\{HOME\})(?=\/)/g, home);
}

function inputWords(text: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote: "'" | '"' | null = null;

  const pushWord = () => {
    if (word) words.push(word);
    word = "";
  };

  const expanded = expandHomeReferences(text);
  for (let index = 0; index < expanded.length; index += 1) {
    const char = expanded[index];
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else if (char === "\\" && quote === '"' && index + 1 < expanded.length) {
        word += expanded[index + 1];
        index += 1;
      } else {
        word += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "\\" && index + 1 < expanded.length) {
      word += expanded[index + 1];
      index += 1;
      continue;
    }
    if (/\s|[`()[\]{},;|&<>=]/.test(char)) {
      pushWord();
      continue;
    }
    word += char;
  }
  pushWord();
  return words;
}

function isPathLikeWord(word: string): boolean {
  return isAbsolute(word) || word.includes("/");
}

function inputReferencesOperatorToken(
  input: AgentToolInput,
  serializedInput: string,
  authorityConfigPath: string | undefined,
): boolean {
  const referencesLiteralPath = scopeAuthorityOperatorTokenPaths(authorityConfigPath).some((path) => {
    const serializedPath = JSON.stringify(path).slice(1, -1).toLowerCase();
    return serializedInput.includes(serializedPath);
  });
  if (referencesLiteralPath) return true;

  const baseDirectory = commandWorkingDirectory(input);
  return Object.values(input).some((value) =>
    typeof value === "string" && inputWords(value).some((candidate) =>
      isPathLikeWord(candidate) &&
      isScopeAuthorityOperatorTokenPath(candidate, {
        baseDirectory,
        authorityConfigPath,
      })
    )
  );
}

export function createScopeAuthorityMutationGuard(
  authorityConfigPath?: string,
): AgentCanUseTool {
  return async (_toolName, input): Promise<AgentPermissionResult> => {
    const serializedInput = inputText(input);
    if (inputReferencesOperatorToken(input, serializedInput, authorityConfigPath)) {
      return {
        behavior: "deny",
        message: SCOPE_AUTHORITY_TOKEN_DENIAL_MESSAGE,
        decisionAttribution: "operator-deny",
      };
    }
    const command = typeof input.command === "string"
      ? normalizeCommand(input.command)
      : serializedInput;
    const directAuthorityMutation =
      serializedInput.includes("project authority set") ||
      serializedInput.includes("/authority") &&
        /(?:put|patch|post)/.test(serializedInput);
    if (!hasScopeAuthorityMutationCommand(command) && !directAuthorityMutation) {
      return { behavior: "allow", updatedInput: input };
    }
    return {
      behavior: "deny",
      message: SCOPE_AUTHORITY_DENIAL_MESSAGE,
      decisionAttribution: "operator-deny",
    };
  };
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

export function createWorkflowShellTeardownGuard(): AgentCanUseTool {
  return async (toolName, input): Promise<AgentPermissionResult> => {
    if (!isShellCommandTool(toolName)) return { behavior: "allow", updatedInput: input };
    const command = typeof input.command === "string" ? input.command : "";
    const kind = classifyWorkflowShellTeardownCommand(command);
    if (kind === null) {
      return { behavior: "allow", updatedInput: input };
    }
    return {
      behavior: "deny",
      message: kind === "local-work"
        ? LOCAL_WORK_TEARDOWN_DENIAL_MESSAGE
        : INFRASTRUCTURE_DESTROY_DENIAL_MESSAGE,
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

function createWorkflowNestingGuard(): AgentCanUseTool {
  return async (toolName, input): Promise<AgentPermissionResult> => {
    if (!WORKFLOW_NESTING_TOOLS.has(toolName)) {
      return { behavior: "allow", updatedInput: input };
    }
    return {
      behavior: "deny",
      message: WORKFLOW_NESTING_DENIAL_MESSAGE,
      decisionAttribution: "operator-deny",
    };
  };
}

/**
 * Standard guard stack applied to every workflow / autonomy agent run:
 * blocks hidden nesting and Git metadata mutation (the workflow owns both), and denies
 * calls that would stop or restart the daemon hosting the agent.
 */
export function createWorkflowAgentGuards(
  authorityConfigPath?: string,
): AgentCanUseTool {
  return composeCanUseTools(
    createScopeAuthorityMutationGuard(authorityConfigPath),
    createDaemonHostControlGuard(),
    createWorkflowShellTeardownGuard(),
    createWorkflowGitOwnershipGuard(),
    createPackageBootstrapGuard(),
    createWorkflowNestingGuard(),
  );
}
