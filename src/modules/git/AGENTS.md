# Git Module

This directory owns the `git` capability pack — version control operations with safety guardrails.

- The single `git` tool handles status, diff, log, show, add, commit, branch, and push.
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

## Boundaries

- Does not own GitHub API operations (those belong in `github/`).
- Does not own file-read or shell execution (those belong in `filesystem/` and `execution/`).
