# Git Module

This directory owns the `git` capability pack — version control operations with safety guardrails.

- The single `git` tool handles status, diff, log, show, add, commit, branch, and push.
- Each operation parses a strict argument grammar before invoking Git. Read
  operations reject file-writing and execution-capable flags, and local paths
  used by any operation must resolve inside the active project, including
  through symlinks.
- Non-lease force-pushes to `main`/`master` are blocked by parsed destination,
  including command-line and configured refspecs, configured push remotes,
  upstream defaults, and cross-branch pushes. Unsupported or abbreviated long
  push options fail closed. Pushes are external-network writes; forced,
  config-selected, and remote-destructive forms are dangerous.
  Deletion of protected local branches is blocked. Large diffs are auto-truncated.
- Tools and tests live here; no tool logic belongs in `src/core/tools/`.
- Automation worktrees use `.worktreeinclude` as a line-oriented allowlist for
  copied local setup files. Entries must be repo-relative, must point at
  git-ignored files or directories, and must not be symlinks.
- Preserved builder recovery checkpoints visible work on the existing task
  branch, then reconciles canonical under the same lock and bounded conflict
  boundary as the final merge gate. Worktree metadata keeps the original base,
  checkpoint, integrated head, conflicts, and disposition. Text conflicts and
  canonical destructive paths may reach the bounded resolver; canonical
  destructive paths must remain absent. Other structural and binary conflicts
  stay review-only.
- Structured semantic conflict feedback can guide another already-budgeted
  bounded attempt; it never expands paths, attempts, or merge authority.
- Merge-gate contention waits cancelably and is never classified as a semantic
  conflict. Lock ownership is token-bound, and locks owned by dead processes
  are reclaimed before another canonical integration begins.

## Boundaries

- Does not own GitHub API operations (those belong in `github/`).
- Does not own file-read or shell execution (those belong in `filesystem/` and `execution/`).
