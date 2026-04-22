import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";

const DENIAL_MESSAGE =
  "Workflow agents must not run `git commit`. Stage changes with `git add` and write `<run-dir>/commit-message.txt`; the workflow's commit step creates the commit after validation gates pass.";

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

export function createAgentCommitGuard(): CanUseTool {
  return async (toolName, input): Promise<PermissionResult> => {
    if (toolName !== "Bash") return { behavior: "allow", updatedInput: input };
    const command = typeof input.command === "string" ? input.command : "";
    if (!isGitCommitCommand(command)) {
      return { behavior: "allow", updatedInput: input };
    }
    // Deny without `interrupt: true`: the SDK translates `interrupt` into
    // `abortController.abort()`, which terminates the entire session with
    // `aborted_tools` / ede_diagnostic. A bare `deny` still prevents the
    // commit and feeds the denial back to the agent as a tool_result, so the
    // agent can adapt instead of losing the whole run.
    return {
      behavior: "deny",
      message: DENIAL_MESSAGE,
      decisionClassification: "user_reject",
    };
  };
}
